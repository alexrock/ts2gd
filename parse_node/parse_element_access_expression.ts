import ts from "typescript"
import { ParseState, parseNode, combine } from "../parse_node"

import { ParseNodeType } from "../parse_node"

export const parseElementAccessExpression = (
  node: ts.ElementAccessExpression,
  props: ParseState
): ParseNodeType => {
  return combine({
    parent: node,
    nodes: [node.expression, node.argumentExpression],
    props,
    parsedStrings: (lhs, rhs) => `${lhs}[${rhs}]`,
  })
}
