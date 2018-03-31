import { ExpressionNode, NodeBase, StatementNode } from './shared/Node';
import { NodeType } from './NodeType';
import {
	findFirstOccurrenceOutsideComment,
	RenderOptions,
	renderStatementList
} from '../../utils/renderHelpers';
import MagicString from 'magic-string';

export default class SwitchCase extends NodeBase {
	type: NodeType.SwitchCase;
	test: ExpressionNode | null;
	consequent: StatementNode[];

	includeInBundle() {
		let addedNewNodes = !this.included;
		this.included = true;
		if (this.test && this.test.includeInBundle()) {
			addedNewNodes = true;
		}
		for (const node of this.consequent) {
			if (node.shouldBeIncluded() && node.includeInBundle()) {
				addedNewNodes = true;
			}
		}
		return addedNewNodes;
	}

	render(code: MagicString, options: RenderOptions) {
		if (this.consequent.length) {
			this.test && this.test.render(code, options);
			const testEnd = this.test
				? this.test.end
				: findFirstOccurrenceOutsideComment(code.original, 'default', this.start) + 7;
			const consequentStart = findFirstOccurrenceOutsideComment(code.original, ':', testEnd) + 1;
			renderStatementList(this.consequent, code, consequentStart, this.end, options);
		} else {
			super.render(code, options);
		}
	}
}
