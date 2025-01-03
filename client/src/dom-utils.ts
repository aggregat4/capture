/**
 * Type guard to check if a Node is a ChildNode
 */
export function isChildNode(node: Node): node is ChildNode {
  return 'remove' in node && 'before' in node && 'after' in node && 'replaceWith' in node
}

/**
 * Safely append a Node to a parent Node
 */
export function safeAppendChild(parent: Node, child: Node): void {
  if (isChildNode(child)) {
    parent.appendChild(child)
  } else {
    const clonedChild = child.cloneNode(true)
    if (isChildNode(clonedChild)) {
      parent.appendChild(clonedChild)
    }
  }
}

/**
 * Safely clone and append a Node to a parent Node
 */
export function safeCloneAndAppend(parent: Node, child: Node): void {
  const clonedChild = child.cloneNode(true)
  if (isChildNode(clonedChild)) {
    parent.appendChild(clonedChild)
  }
}

/**
 * Convert a Node to a ChildNode if possible
 */
export function toChildNode(node: Node): ChildNode | null {
  if (isChildNode(node)) {
    return node
  }
  const cloned = node.cloneNode(true)
  return isChildNode(cloned) ? cloned : null
}

/**
 * Safely get child nodes as an array of ChildNode
 */
export function getChildNodesArray(node: Node): ChildNode[] {
  return Array.from(node.childNodes).filter(isChildNode)
}

/**
 * Safely get element children as an array of HTMLElement
 */
export function getElementChildrenArray(element: Element): HTMLElement[] {
  return Array.from(element.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
} 