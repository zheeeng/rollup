import ClassNode from './shared/ClassNode';
import Scope from '../scopes/Scope';
import Identifier from './Identifier';
import MagicString from 'magic-string';
import { NodeType } from './NodeType';
import { Node } from './shared/Node';
import { RenderOptions } from '../../utils/renderHelpers';
import Import from './Import';

export function isClassDeclaration(node: Node): node is ClassDeclaration {
	return node.type === NodeType.ClassDeclaration;
}

export default class ClassDeclaration extends ClassNode {
	type: NodeType.ClassDeclaration;
	id: Identifier;

	initialiseChildren(parentScope: Scope, dynamicImportReturnList: Import[]) {
		// Class declarations are like let declarations: Not hoisted, can be reassigned, cannot be redeclared
		if (this.id) {
			this.id.initialiseAndDeclare(parentScope, dynamicImportReturnList, 'class', this);
			this.id.variable.isId = true;
		}
		super.initialiseChildren(parentScope, dynamicImportReturnList);
	}

	render(code: MagicString, options: RenderOptions) {
		if (options.systemBindings && this.id && this.id.variable.exportName) {
			code.appendLeft(
				this.end,
				` exports('${this.id.variable.exportName}', ${this.id.variable.getName()});`
			);
		}
		super.render(code, options);
	}
}
