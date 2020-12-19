import ts from "typescript";
import { combine, ParseState } from "../parse_node";
import { ParseNodeType } from "../parse_node"

export const parseConditionalExpression = (node: ts.ConditionalExpression, props: ParseState): ParseNodeType => {
  return combine({
    parent: node,
    nodes: [node.condition, node.whenTrue, node.whenFalse],
    props,
    content: (cond, true_, false_) => {
      return `${true_} if ${cond} else ${false_}`;
    }
  });
}
