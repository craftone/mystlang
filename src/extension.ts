// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

async function doesFileExists(filePath: string): Promise<Boolean> {
	try {
		await fs.access(filePath, fs.constants.F_OK);
		return true;
	} catch (err) {
		return false;
	}
}

function isMarkdownFile(fileName: string): Boolean {
	return fileName.endsWith('.md');
}

async function findMarkdownFiles(dirPath: string): Promise<Set<string>> {
	let markdownFiles: Set<string> = new Set();

	async function searchDirectory(directory: string) {
		const files = await fs.readdir(directory, { withFileTypes: true });

		for (const file of files) {
			const fullPath = path.join(directory, file.name);

			if (file.isDirectory()) {
				await searchDirectory(fullPath);
			} else {
				if (isMarkdownFile(file.name)) {
					markdownFiles.add(fullPath);
				}
			}
		}
	}

	await searchDirectory(dirPath);
	return markdownFiles;
}

async function getSphinxRoot(dirPath: string): Promise<string | undefined> {
	const KEY_FILE = 'conf.py';
	if (await doesFileExists(path.join(dirPath, KEY_FILE))) {
		return dirPath;
	}
	const parentDirPath = path.dirname(dirPath);
	if (parentDirPath === dirPath) {
		// Already in the root directory
		return undefined;
	}
	return await getSphinxRoot(parentDirPath);
}

//
// Regular Expressions
//

// section identifiers {#
const SecStartRegEx = '^\\s*\\{#';
// {figure-md}
const FigureMdRegEx = '^[`:]{3,}\\{figure-md\\}\\s*';
// :name:
const NameRegEx = '^\\s*:name:\\s*';
// label
const LabelRegEx = '[\\w:+\\-.,@]+';


function queryCrossRefDefLocations(textDoc: vscode.TextDocument): { [key: string]: vscode.Location } {
	const regex = new RegExp(`(${SecStartRegEx}|${FigureMdRegEx}|${NameRegEx})(${LabelRegEx})`, 'dg');

	let locations: { [key: string]: vscode.Location } = {};
	for (let row = 0; row < textDoc.lineCount; row++) {
		for (const match of textDoc.lineAt(row).text.matchAll(regex)) {
			if (match.indices && match.indices[2]) {
				const symbol = match[2];
				const range = new vscode.Range(
					new vscode.Position(row, match.indices[2][0]),
					new vscode.Position(row, match.indices[2][1]),
				);
				locations[symbol] = new vscode.Location(textDoc.uri, range);
			}
		}
	}
	return locations;
}

async function queryAllDefLocations(curDoc: vscode.TextDocument): Promise<{ [key: string]: vscode.Location }> {

	const sphinxRootDir = await getSphinxRoot(path.dirname(curDoc.fileName));
	if (!sphinxRootDir) {
		return queryCrossRefDefLocations(curDoc);
	}

	let markdownFiles = await findMarkdownFiles(sphinxRootDir);

	// Open each markdown files and query cross reference IDs asynchronously.
	let allSymbols: { [key: string]: vscode.Location } = {};
	await Promise.all(Array.from(markdownFiles).map(async (f) => {
		const textDoc = await vscode.workspace.openTextDocument(f);
		const symbols = queryCrossRefDefLocations(textDoc);
		allSymbols = { ...allSymbols, ...symbols };
	}));

	return allSymbols;
}

function queryReferenceLocations(textDoc: vscode.TextDocument): { [key: string]: vscode.Location[] } {
	const regex = new RegExp(`(\\{numref\\}\`|\\]\\()(${LabelRegEx})`, 'dg');

	let locations: { [key: string]: vscode.Location[] } = {};
	for (let row = 0; row < textDoc.lineCount; row++) {
		for (const match of textDoc.lineAt(row).text.matchAll(regex)) {
			if (match.indices && match.indices[2]) {
				const symbol = match[2];
				const range = new vscode.Range(
					new vscode.Position(row, match.indices[2][0]),
					new vscode.Position(row, match.indices[2][1]),
				);
				const location = new vscode.Location(textDoc.uri, range);
				if (locations[symbol]) {
					locations[symbol].push(location);
				} else {
					locations[symbol] = [location];
				}
			}
		}
	}
	return locations;
}

async function queryAllReferenceLocations(curDoc: vscode.TextDocument): Promise<{ [key: string]: vscode.Location[] }> {

	const sphinxRootDir = await getSphinxRoot(path.dirname(curDoc.fileName));
	if (!sphinxRootDir) {
		return queryReferenceLocations(curDoc);
	}

	let markdownFiles = await findMarkdownFiles(sphinxRootDir);

	// Open each markdown files and query cross reference IDs asynchronously.
	let allSymbols: { [key: string]: vscode.Location[] } = {};
	const locsList = await Promise.all(Array.from(markdownFiles).map(async (f) => {
		const textDoc = await vscode.workspace.openTextDocument(f);
		const refLocs = queryReferenceLocations(textDoc);
		// Add locations to allSymbols
		Object.keys(refLocs).forEach(symbol => {
			if (allSymbols[symbol]) {
				allSymbols[symbol].concat(refLocs[symbol]);
			} else {
				allSymbols[symbol] = refLocs[symbol];
			}
		});
	}));

	return allSymbols;
}

class MySTCompletionItemProvider implements vscode.CompletionItemProvider {
	public async provideCompletionItems(
		document: vscode.TextDocument, position: vscode.Position,
		token: vscode.CancellationToken, context: vscode.CompletionContext
	): Promise<vscode.CompletionItem[] | undefined> {

		// Check if the current condition meets the criteria to trigger the event
		if (context.triggerCharacter === '`') {
			const keyword = '{numref}`';
			if (!document.lineAt(position.line).text
				.substring(position.character - keyword.length)
				.startsWith(keyword)) {
				// Only {numref}`| is the case
				return undefined;
			}
		} else if (context.triggerCharacter === '(') {
			if (document.lineAt(position.line).text.substring(position.character - 1, 1) !== ']') {
				// Only ](|  is the case
				return undefined;
			}
		}

		const allIDLocations = await queryAllDefLocations(document);

		return Object.keys(allIDLocations).map(
			id => new vscode.CompletionItem(id, vscode.CompletionItemKind.Constant)
		);
	}
}


class MySTDefinitionProvider implements vscode.DefinitionProvider {
	public async provideDefinition(
		document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken
	): Promise<vscode.Location | undefined> {
		// Identify the symbol where the caret is located.
		const wordRange = document.getWordRangeAtPosition(position, new RegExp(`${LabelRegEx}`));
		if (!wordRange) {
			return undefined;
		}
		const symbol = document.getText(wordRange);

		const allIDLocations = await queryAllDefLocations(document);
		return allIDLocations[symbol];
	}
}

class MySTReferenceProvider implements vscode.ReferenceProvider {
	public async provideReferences(
		document: vscode.TextDocument, position: vscode.Position,
		options: { includeDeclaration: boolean }, token: vscode.CancellationToken
	): Promise<vscode.Location[] | undefined> {
		// Identify the symbol where the caret is located.
		const wordRange = document.getWordRangeAtPosition(position, new RegExp(`${LabelRegEx}`));
		if (!wordRange) {
			return undefined;
		}
		const symbol = document.getText(wordRange);

		const allRefLocations = await queryAllReferenceLocations(document);
		return allRefLocations[symbol];
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('"mystlang" is now active!');

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider('markdown', new MySTCompletionItemProvider, '(', '`'),
		vscode.languages.registerDefinitionProvider('markdown', new MySTDefinitionProvider),
		vscode.languages.registerReferenceProvider('markdown', new MySTReferenceProvider),
	);

}

// This method is called when your extension is deactivated
export function deactivate() { }
