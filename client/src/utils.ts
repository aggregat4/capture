import DOMPurify from 'dompurify'
import { DOMPurifyConfig } from './types'
import * as Y from 'yjs'

export const purifyConfig: DOMPurifyConfig = {
  ALLOWED_TAGS: ['p', 'strong', 'em', 'b', 'i', 'ul', 'li', 'br'],
  ALLOWED_ATTR: [],
  KEEP_CONTENT: true,
  ALLOW_EMPTY_TAGS: ['p', 'li']
}

export const wrapInParagraphs = (html: string): string => {
  const div = document.createElement('div')
  div.innerHTML = DOMPurify.sanitize(html, purifyConfig)
  
  const fragment = document.createDocumentFragment()
  let currentP: HTMLParagraphElement | null = null
  
  Array.from(div.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') {
      if (!currentP) {
        currentP = document.createElement('p')
        fragment.appendChild(currentP)
      }
      currentP.appendChild(node.cloneNode(true))
      if (node.nodeName === 'BR') {
        currentP = null
      }
    } else {
      currentP = null
      fragment.appendChild(node.cloneNode(true))
    }
  })
  
  if (currentP && currentP.textContent?.trim()) {
    fragment.appendChild(currentP)
  }
  
  div.innerHTML = ''
  div.appendChild(fragment)
  return div.innerHTML
}

export const htmlToPlainText = (html: string): string => {
  const div = document.createElement('div')
  div.innerHTML = html
  
  const walk = (node: Node): string => {
    let text = ''
    
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || ''
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      const tag = element.tagName.toLowerCase()
      const children = Array.from(node.childNodes).map(walk).join('')
      
      switch (tag) {
        case 'p':
          return !children.trim() ? '\n' : children + '\n'
        case 'br':
          return '\n'
        case 'ul':
          return children
        case 'li':
          return '• ' + children + '\n'
        case 'strong':
          return `<strong>${children}</strong>`
        case 'em':
          return `<em>${children}</em>`
        default:
          return children
      }
    }
    
    return ''
  }
  
  return walk(div).replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

export const plainTextToHtml = (text: string): string => {
  if (!text) return ''
  
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = text
  
  const lines = tempDiv.innerHTML.split('\n')
  let inList = false
  let html = ''
  let skipNextEmptyLine = false
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmedLine = line.trim()
    const isLastLine = i === lines.length - 1
    
    if (trimmedLine.startsWith('•')) {
      skipNextEmptyLine = false
      if (!inList) {
        html += '<ul>'
        inList = true
      }
      html += `<li>${trimmedLine.substring(1).trim()}</li>`
    } else {
      if (inList) {
        html += '</ul>'
        inList = false
        skipNextEmptyLine = true
      }
      
      if (!trimmedLine) {
        if (!skipNextEmptyLine && !isLastLine) {
          html += '<p></p>'
        }
        skipNextEmptyLine = false
      } else {
        skipNextEmptyLine = false
        html += `<p>${trimmedLine}</p>`
      }
    }
  }
  
  if (inList) {
    html += '</ul>'
  }
  
  return html
}

export const getXmlFragmentContent = (xmlFragment: Y.XmlFragment): string => {
  let content = ''
  xmlFragment.forEach(item => {
    if (typeof item === 'string') {
      content += item
    } else if (item instanceof Y.XmlText) {
      content += item.toString()
    } else if (item instanceof Y.XmlElement) {
      const tag = item.nodeName
      const innerContent = getXmlFragmentContent(item)
      switch (tag) {
        case 'p':
          content += innerContent + '\n'
          break
        case 'ul':
          content += innerContent + '\n'
          break
        case 'li':
          content += '• ' + innerContent + '\n'
          break
        case 'strong':
        case 'b':
          content += `<strong>${innerContent}</strong>`
          break
        case 'em':
        case 'i':
          content += `<em>${innerContent}</em>`
          break
        default:
          content += innerContent
      }
    }
  })
  return content.trim()
} 