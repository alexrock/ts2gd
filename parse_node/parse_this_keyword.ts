import ts from "typescript"

import { combine, ParseNodeType, ParseState } from "../parse_node"

export const parseThisKeyword = (
  node: ts.ThisExpression,
  props: ParseState
): ParseNodeType => {
  return combine({
    parent: node,
    nodes: [],
    props,
    parsedStrings: () => `self`,
  })
}
