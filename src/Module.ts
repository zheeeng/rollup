import { IParse, Options as AcornOptions } from 'acorn';
import MagicString from 'magic-string';
import { locate } from 'locate-character';
import { timeEnd, timeStart } from './utils/timers';
import { basename, extname } from './utils/path';
import { makeLegal } from './utils/identifierHelpers';
import getCodeFrame from './utils/getCodeFrame';
import { SOURCEMAPPING_URL_RE } from './utils/sourceMappingURL';
import error, { RollupError } from './utils/error';
import NamespaceVariable from './ast/variables/NamespaceVariable';
import extractNames from './ast/utils/extractNames';
import ModuleScope from './ast/scopes/ModuleScope';
import { RawSourceMap } from 'source-map';
import ImportSpecifier from './ast/nodes/ImportSpecifier';
import Graph from './Graph';
import Variable from './ast/variables/Variable';
import Program from './ast/nodes/Program';
import { Node } from './ast/nodes/shared/Node';
import ExportNamedDeclaration from './ast/nodes/ExportNamedDeclaration';
import ImportDeclaration from './ast/nodes/ImportDeclaration';
import Identifier from './ast/nodes/Identifier';
import ExportDefaultDeclaration, {
	isExportDefaultDeclaration
} from './ast/nodes/ExportDefaultDeclaration';
import FunctionDeclaration from './ast/nodes/FunctionDeclaration';
import ExportAllDeclaration from './ast/nodes/ExportAllDeclaration';
import ImportDefaultSpecifier from './ast/nodes/ImportDefaultSpecifier';
import ImportNamespaceSpecifier from './ast/nodes/ImportNamespaceSpecifier';
import { RollupWarning } from './rollup/index';
import ExternalModule from './ExternalModule';
import ExternalVariable from './ast/variables/ExternalVariable';
import Import from './ast/nodes/Import';
import nodeConstructors, { NodeType } from './ast/nodes/index';
import { isTemplateLiteral } from './ast/nodes/TemplateLiteral';
import { isLiteral } from './ast/nodes/Literal';
import Chunk from './Chunk';
import { RenderOptions } from './utils/renderHelpers';

export interface IdMap {
	[key: string]: string;
}

export interface CommentDescription {
	block: boolean;
	text: string;
	start: number;
	end: number;
}

export interface ImportDescription {
	source: string;
	specifier: ImportSpecifier | ImportNamespaceSpecifier | ImportDefaultSpecifier;
	name: string;
	module: Module | ExternalModule | null;
}

export interface ExportDescription {
	localName: string;
	identifier?: string;
}

export interface ReexportDescription {
	localName: string;
	start: number;
	source: string;
	module: Module;
}

export const defaultAcornOptions: AcornOptions = {
	// TODO TypeScript waiting for acorn types to be updated
	ecmaVersion: <any>2018,
	sourceType: 'module',
	preserveParens: false
};

function tryParse(module: Module, parse: IParse, acornOptions: AcornOptions) {
	try {
		return parse(
			module.code,
			Object.assign({}, defaultAcornOptions, acornOptions, {
				onComment: (block: boolean, text: string, start: number, end: number) =>
					module.comments.push({ block, text, start, end })
			})
		);
	} catch (err) {
		module.error(
			{
				code: 'PARSE_ERROR',
				message: err.message.replace(/ \(\d+:\d+\)$/, '')
			},
			err.pos
		);
	}
}

function includeFully(node: Node) {
	node.included = true;
	if (node.variable && !node.variable.included) {
		node.variable.includeVariable();
	}
	node.eachChild(includeFully);
}

export interface ModuleJSON {
	id: string;
	dependencies: string[];
	code: string;
	originalCode: string;
	originalSourcemap: RawSourceMap | void;
	ast: Program;
	sourcemapChain: RawSourceMap[];
	resolvedIds: IdMap;
}

export default class Module {
	type: 'Module';
	graph: Graph;
	code: string;
	comments: CommentDescription[];
	context: string;
	dependencies: (Module | ExternalModule)[];
	excludeFromSourcemap: boolean;
	exports: { [name: string]: ExportDescription };
	exportsAll: { [name: string]: string };
	exportAllSources: string[];
	id: string;

	imports: { [name: string]: ImportDescription };
	isExternal: false;
	magicString: MagicString;
	originalCode: string;
	originalSourcemap: RawSourceMap | void;
	reexports: { [name: string]: ReexportDescription };
	resolvedIds: IdMap;
	scope: ModuleScope;
	sourcemapChain: RawSourceMap[];
	sources: string[];
	dynamicImports: Import[];
	dynamicImportResolutions: {
		alias: string;
		resolution: Module | ExternalModule | string | void;
	}[];

	execIndex: number;
	isEntryPoint: boolean;
	chunkAlias: string;
	entryPointsHash: Uint8Array;
	chunk: Chunk;

	ast: Program;
	private esTreeAst: any;

	// this is unused on Module,
	// only used for namespace and then ExternalExport.declarations
	declarations: {
		'*'?: NamespaceVariable;
		[name: string]: Variable | undefined;
	};
	exportAllModules: (Module | ExternalModule)[];

	constructor(graph: Graph, id: string) {
		this.id = id;
		this.chunkAlias = undefined;
		this.graph = graph;
		this.comments = [];

		if (graph.dynamicImport) {
			this.dynamicImports = [];
			this.dynamicImportResolutions = [];
		}
		this.isEntryPoint = false;
		this.execIndex = null;
		this.entryPointsHash = new Uint8Array(10);

		this.excludeFromSourcemap = /\0/.test(id);
		this.context = graph.getModuleContext(id);

		// all dependencies
		this.sources = [];
		this.dependencies = [];

		// imports and exports, indexed by local name
		this.imports = Object.create(null);
		this.exports = Object.create(null);
		this.exportsAll = Object.create(null);
		this.reexports = Object.create(null);

		this.exportAllSources = [];
		this.exportAllModules = null;

		this.declarations = Object.create(null);
		this.scope = new ModuleScope(this);
	}

	setSource({
		code,
		originalCode,
		originalSourcemap,
		ast,
		sourcemapChain,
		resolvedIds
	}: {
		code: string;
		originalCode: string;
		originalSourcemap: RawSourceMap;
		ast: any;
		sourcemapChain: RawSourceMap[];
		resolvedIds?: IdMap;
	}) {
		this.code = code;
		this.originalCode = originalCode;
		this.originalSourcemap = originalSourcemap;
		this.sourcemapChain = sourcemapChain;

		timeStart('generate ast', 3);

		this.esTreeAst = ast || tryParse(this, this.graph.acornParse, this.graph.acornOptions);

		timeEnd('generate ast', 3);

		this.resolvedIds = resolvedIds || Object.create(null);

		// By default, `id` is the filename. Custom resolvers and loaders
		// can change that, but it makes sense to use it for the source filename
		this.magicString = new MagicString(code, {
			filename: this.excludeFromSourcemap ? null : this.id, // don't include plugin helpers in sourcemap
			indentExclusionRanges: []
		});
		this.removeExistingSourceMap();

		timeStart('analyse ast', 3);

		this.analyse();

		timeEnd('analyse ast', 3);
	}

	private removeExistingSourceMap() {
		for (const comment of this.comments) {
			if (!comment.block && SOURCEMAPPING_URL_RE.test(comment.text)) {
				this.magicString.remove(comment.start, comment.end);
			}
		}
	}

	private addExport(
		node: ExportAllDeclaration | ExportNamedDeclaration | ExportDefaultDeclaration
	) {
		const source = (<ExportAllDeclaration>node).source && (<ExportAllDeclaration>node).source.value;

		// export { name } from './other'
		if (source) {
			if (this.sources.indexOf(source) === -1) this.sources.push(source);

			if (node.type === NodeType.ExportAllDeclaration) {
				// Store `export * from '...'` statements in an array of delegates.
				// When an unknown import is encountered, we see if one of them can satisfy it.
				this.exportAllSources.push(source);
			} else {
				for (const specifier of (<ExportNamedDeclaration>node).specifiers) {
					const name = specifier.exported.name;

					if (this.exports[name] || this.reexports[name]) {
						this.error(
							{
								code: 'DUPLICATE_EXPORT',
								message: `A module cannot have multiple exports with the same name ('${name}')`
							},
							specifier.start
						);
					}

					this.reexports[name] = {
						start: specifier.start,
						source,
						localName: specifier.local.name,
						module: null // filled in later
					};
				}
			}
		} else if (isExportDefaultDeclaration(node)) {
			// export default function foo () {}
			// export default foo;
			// export default 42;
			const identifier =
				((<FunctionDeclaration>node.declaration).id &&
					(<FunctionDeclaration>node.declaration).id.name) ||
				(<Identifier>node.declaration).name;
			if (this.exports.default) {
				this.error(
					{
						code: 'DUPLICATE_EXPORT',
						message: `A module can only have one default export`
					},
					node.start
				);
			}

			this.exports.default = {
				localName: 'default',
				identifier
			};
		} else if ((<ExportNamedDeclaration>node).declaration) {
			// export var { foo, bar } = ...
			// export var foo = 42;
			// export var a = 1, b = 2, c = 3;
			// export function foo () {}
			const declaration = (<ExportNamedDeclaration>node).declaration;

			if (declaration.type === NodeType.VariableDeclaration) {
				for (const decl of declaration.declarations) {
					for (const localName of extractNames(decl.id)) {
						this.exports[localName] = { localName };
					}
				}
			} else {
				// export function foo () {}
				const localName = declaration.id.name;
				this.exports[localName] = { localName };
			}
		} else {
			// export { foo, bar, baz }
			for (const specifier of (<ExportNamedDeclaration>node).specifiers) {
				const localName = specifier.local.name;
				const exportedName = specifier.exported.name;

				if (this.exports[exportedName] || this.reexports[exportedName]) {
					this.error(
						{
							code: 'DUPLICATE_EXPORT',
							message: `A module cannot have multiple exports with the same name ('${exportedName}')`
						},
						specifier.start
					);
				}

				this.exports[exportedName] = { localName };
			}
		}
	}

	private addImport(node: ImportDeclaration) {
		const source = node.source.value;

		if (this.sources.indexOf(source) === -1) this.sources.push(source);

		for (const specifier of node.specifiers) {
			const localName = specifier.local.name;

			if (this.imports[localName]) {
				this.error(
					{
						code: 'DUPLICATE_IMPORT',
						message: `Duplicated import '${localName}'`
					},
					specifier.start
				);
			}

			const isDefault = specifier.type === NodeType.ImportDefaultSpecifier;
			const isNamespace = specifier.type === NodeType.ImportNamespaceSpecifier;

			const name = isDefault
				? 'default'
				: isNamespace ? '*' : (<ImportSpecifier>specifier).imported.name;
			this.imports[localName] = { source, specifier, name, module: null };
		}
	}

	private analyse() {
		this.ast = new Program(this.esTreeAst, nodeConstructors, {}, this);
		for (const node of this.ast.body) {
			node.initialise(this.scope, this.dynamicImports);
		}
		for (const node of this.ast.body) {
			if ((<ImportDeclaration>node).isImportDeclaration) {
				this.addImport(<ImportDeclaration>node);
			} else if (
				(<ExportDefaultDeclaration | ExportNamedDeclaration | ExportAllDeclaration>node)
					.isExportDeclaration
			) {
				this.addExport(<
					| ExportDefaultDeclaration
					| ExportNamedDeclaration
					| ExportAllDeclaration>node);
			}
		}
	}

	basename() {
		const base = basename(this.id);
		const ext = extname(this.id);

		return makeLegal(ext ? base.slice(0, -ext.length) : base);
	}

	markExports() {
		for (const exportName of this.getExports()) {
			const variable = this.traceExport(exportName);

			variable.exportName = exportName;
			variable.includeVariable();

			if (variable.isNamespace) {
				(<NamespaceVariable>variable).needsNamespaceBlock = true;
			}
		}

		for (const name of this.getReexports()) {
			const variable = this.traceExport(name);

			variable.exportName = name;

			if (variable.isExternal) {
				variable.reexported = (<ExternalVariable>variable).module.reexported = true;
			} else {
				variable.includeVariable();
			}
		}
	}

	linkDependencies() {
		for (let source of this.sources) {
			const id = this.resolvedIds[source];

			if (id) {
				const module = this.graph.moduleById.get(id);
				this.dependencies.push(<Module>module);
			}
		}

		const resolveSpecifiers = (specifiers: {
			[name: string]: ImportDescription | ReexportDescription;
		}) => {
			for (let name of Object.keys(specifiers)) {
				const specifier = specifiers[name];

				const id = this.resolvedIds[specifier.source];
				specifier.module = this.graph.moduleById.get(id);
			}
		};

		resolveSpecifiers(this.imports);
		resolveSpecifiers(this.reexports);

		this.exportAllModules = this.exportAllSources.map(source => {
			const id = this.resolvedIds[source];
			return this.graph.moduleById.get(id);
		});
	}

	bindReferences() {
		for (let node of this.ast.body) {
			node.bind();
		}
	}

	getDynamicImportExpressions(): (string | Node)[] {
		return this.dynamicImports.map(node => {
			const importArgument = node.parent.arguments[0];
			if (isTemplateLiteral(importArgument)) {
				if (importArgument.expressions.length === 0 && importArgument.quasis.length === 1) {
					return importArgument.quasis[0].value.cooked;
				}
			} else if (isLiteral(importArgument)) {
				if (typeof importArgument.value === 'string') {
					return <string>importArgument.value;
				}
			} else {
				return importArgument;
			}
		});
	}

	private getOriginalLocation(
		sourcemapChain: RawSourceMap[],
		location: { line: number; column: number; source?: string; name?: string }
	) {
		const filteredSourcemapChain = sourcemapChain.filter(sourcemap => sourcemap.mappings);

		while (filteredSourcemapChain.length > 0) {
			const sourcemap = filteredSourcemapChain.pop();
			const line: any = sourcemap.mappings[location.line - 1];
			let locationFound = false;

			if (line !== undefined) {
				for (const segment of line) {
					if (segment[0] >= location.column) {
						if (segment.length < 4) break;
						location = {
							line: segment[2] + 1,
							column: segment[3],
							source: sourcemap.sources[segment[1]],
							name: sourcemap.names[segment[4]]
						};
						locationFound = true;
						break;
					}
				}
			}
			if (!locationFound) {
				throw new Error("Can't resolve original location of error.");
			}
		}
		return location;
	}

	error(props: RollupError, pos: number) {
		if (pos !== undefined) {
			props.pos = pos;

			let location = locate(this.code, pos, { offsetLine: 1 });
			try {
				location = this.getOriginalLocation(this.sourcemapChain, location);
			} catch (e) {
				this.warn(
					{
						loc: {
							file: this.id,
							line: location.line,
							column: location.column
						},
						pos: pos,
						message: `Error when using sourcemap for reporting an error: ${e.message}`,
						code: 'SOURCEMAP_ERROR'
					},
					undefined
				);
			}

			props.loc = {
				file: this.id,
				line: location.line,
				column: location.column
			};
			props.frame = getCodeFrame(this.originalCode, location.line, location.column);
		}

		error(props);
	}

	getAllExports() {
		const allExports = Object.assign(Object.create(null), this.exports, this.reexports);

		this.exportAllModules.forEach(module => {
			if (module.isExternal) {
				allExports[`*${module.id}`] = true;
				return;
			}

			for (const name of (<Module>module).getAllExports()) {
				if (name !== 'default') allExports[name] = true;
			}
		});

		return Object.keys(allExports);
	}

	getExports() {
		return Object.keys(this.exports);
	}

	getReexports() {
		const reexports = Object.create(null);

		for (const name in this.reexports) {
			reexports[name] = true;
		}

		this.exportAllModules.forEach(module => {
			if (module.isExternal) {
				reexports[`*${module.id}`] = true;
				return;
			}

			for (const name of (<Module>module).getExports().concat((<Module>module).getReexports())) {
				if (name !== 'default') reexports[name] = true;
			}
		});

		return Object.keys(reexports);
	}

	includeAllInBundle() {
		for (let node of this.ast.body) {
			includeFully(node);
		}
	}

	includeInBundle() {
		let addedNewNodes = false;
		for (let node of this.ast.body) {
			if (node.shouldBeIncluded()) {
				if (node.includeInBundle()) {
					addedNewNodes = true;
				}
			}
		}
		return addedNewNodes;
	}

	namespace(): NamespaceVariable {
		if (!this.declarations['*']) {
			this.declarations['*'] = new NamespaceVariable(this);
		}

		return this.declarations['*'];
	}

	render(options: RenderOptions): MagicString {
		const magicString = this.magicString.clone();
		this.ast.render(magicString, options);
		return magicString;
	}

	toJSON(): ModuleJSON {
		return {
			id: this.id,
			dependencies: this.dependencies.map(module => module.id),
			code: this.code,
			originalCode: this.originalCode,
			originalSourcemap: this.originalSourcemap,
			ast: this.esTreeAst,
			sourcemapChain: this.sourcemapChain,
			resolvedIds: this.resolvedIds
		};
	}

	trace(name: string): Variable {
		// TODO this is slightly circular
		if (name in this.scope.variables) {
			return this.scope.variables[name];
		}

		if (name in this.imports) {
			const importDeclaration = this.imports[name];
			const otherModule = importDeclaration.module;

			if (!otherModule.isExternal && importDeclaration.name === '*') {
				return (<Module>otherModule).namespace();
			}

			const declaration = otherModule.traceExport(importDeclaration.name);

			if (!declaration) {
				this.graph.handleMissingExport(
					importDeclaration.name,
					this,
					otherModule.id,
					importDeclaration.specifier.start
				);
			}

			return declaration;
		}

		return null;
	}

	traceExport(name: string): Variable {
		if (name[0] === '*') {
			// namespace
			if (name.length === 1) {
				return this.namespace();
				// export * from 'external'
			} else {
				const module = <ExternalModule>this.graph.moduleById.get(name.slice(1));
				return module.traceExport('*');
			}
		}

		// export { foo } from './other'
		const reexportDeclaration = this.reexports[name];
		if (reexportDeclaration) {
			const declaration = reexportDeclaration.module.traceExport(reexportDeclaration.localName);

			if (!declaration) {
				this.graph.handleMissingExport(
					reexportDeclaration.localName,
					this,
					reexportDeclaration.module.id,
					reexportDeclaration.start
				);
			}

			return declaration;
		}

		const exportDeclaration = this.exports[name];
		if (exportDeclaration) {
			const name = exportDeclaration.localName;
			const declaration = this.trace(name);

			return declaration || this.graph.scope.findVariable(name);
		}

		if (name === 'default') return;

		for (let i = 0; i < this.exportAllModules.length; i += 1) {
			const module = this.exportAllModules[i];
			const declaration = module.traceExport(name);

			if (declaration) return declaration;
		}
	}

	warn(warning: RollupWarning, pos: number) {
		if (pos !== undefined) {
			warning.pos = pos;

			const { line, column } = locate(this.code, pos, { offsetLine: 1 }); // TODO trace sourcemaps, cf. error()

			warning.loc = { file: this.id, line, column };
			warning.frame = getCodeFrame(this.code, line, column);
		}

		warning.id = this.id;
		this.graph.warn(warning);
	}
}
