'use client'
import React, { useMemo, useState } from 'react'

// Minimal dc-runtime-compatible renderer. It interprets the prototype's
// original body markup (sc-for / sc-if / {{ path }} / onclick / style-hover)
// against a scope object, so the layout is reused verbatim and only the logic
// is ported (see useTerminal). This guarantees visual fidelity with the source.

export type Scope = Record<string, unknown>

// Resolve a dotted path / literal against the scope. Values keep their type
// (string, number, function, React element, array...).
function resolve(expr: string, scope: Scope): unknown {
  const e = expr.trim()
  if (e === 'true') return true
  if (e === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e)
  let cur: unknown = scope
  for (const part of e.split('.')) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

const BRACES = /\{\{([^}]+)\}\}/g

// Interpolate a string that may contain {{ }} segments. If the string is a
// single {{ x }}, the raw value is returned (preserving element/function type).
// Mixed strings return either a joined string or an array of nodes when an
// embedded value is a React element.
function interpolate(text: string, scope: Scope): unknown {
  const whole = text.match(/^\s*\{\{([^}]+)\}\}\s*$/)
  if (whole) return resolve(whole[1], scope)
  if (!text.includes('{{')) return text

  const parts: unknown[] = []
  let last = 0
  let m: RegExpExecArray | null
  BRACES.lastIndex = 0
  while ((m = BRACES.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(resolve(m[1], scope))
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  if (parts.some((p) => React.isValidElement(p))) return parts
  return parts.map((p) => (p == null ? '' : String(p))).join('')
}

const VENDOR = /^(webkit|moz|ms|o)([A-Z])/
function camel(prop: string): string {
  const c = prop.trim().replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())
  return c.replace(VENDOR, (_, v, ch) => v.charAt(0).toUpperCase() + v.slice(1) + ch)
}

// Parse a CSS declaration string into a React style object.
function parseStyle(css: string): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const prop = decl.slice(0, i).trim()
    const val = decl.slice(i + 1).trim()
    if (!prop) continue
    if (prop.startsWith('--')) out[prop] = val
    else out[camel(prop)] = val
  }
  return out as React.CSSProperties
}

// An element carrying a style-hover declaration: merges the hover style on
// mouse enter, mirroring dc-runtime's behaviour.
function HoverEl({
  tag,
  base,
  hover,
  props,
  children,
}: {
  tag: string
  base: React.CSSProperties
  hover: React.CSSProperties
  props: Record<string, unknown>
  children: React.ReactNode
}) {
  const [on, setOn] = useState(false)
  return React.createElement(
    tag,
    {
      ...props,
      style: on ? { ...base, ...hover } : base,
      onMouseEnter: () => setOn(true),
      onMouseLeave: () => setOn(false),
    },
    children,
  )
}

let keySeq = 0

function renderChildren(parent: Element, scope: Scope): React.ReactNode[] {
  const out: React.ReactNode[] = []
  parent.childNodes.forEach((node) => {
    const rendered = renderNode(node, scope)
    if (Array.isArray(rendered)) out.push(...rendered)
    else if (rendered != null && rendered !== '') out.push(rendered)
  })
  // Wrap each child in a keyed Fragment so React never warns about list keys.
  return out.map((c, i) => <React.Fragment key={i}>{c}</React.Fragment>)
}

function renderNode(node: ChildNode, scope: Scope): React.ReactNode {
  if (node.nodeType === 3 /* text */) {
    const val = interpolate(node.textContent ?? '', scope)
    if (Array.isArray(val)) {
      return val.map((v, i) => <React.Fragment key={i}>{v as React.ReactNode}</React.Fragment>)
    }
    return val as React.ReactNode
  }
  if (node.nodeType !== 1 /* element */) return null

  const el = node as Element
  const tag = el.tagName.toLowerCase()

  if (tag === 'sc-for') {
    const list = resolve((el.getAttribute('list') ?? '').replace(/\{\{|\}\}/g, ''), scope)
    const as = el.getAttribute('as') ?? 'item'
    if (!Array.isArray(list)) return []
    return list.flatMap((item, i) => {
      const childScope = { ...scope, [as]: item }
      const kids = renderChildren(el, childScope)
      return <React.Fragment key={i}>{kids}</React.Fragment>
    })
  }

  if (tag === 'sc-if') {
    const value = resolve((el.getAttribute('value') ?? '').replace(/\{\{|\}\}/g, ''), scope)
    if (!value) return null
    return renderChildren(el, scope)
  }

  // ordinary element
  const props: Record<string, unknown> = { key: `k${keySeq++}` }
  let baseStyle: React.CSSProperties | undefined
  let hoverStyle: React.CSSProperties | undefined

  for (const attr of Array.from(el.attributes)) {
    const name = attr.name
    if (name.startsWith('hint-placeholder')) continue
    const raw = attr.value
    if (name === 'style') {
      const v = interpolate(raw, scope)
      baseStyle = parseStyle(typeof v === 'string' ? v : raw)
    } else if (name === 'style-hover') {
      hoverStyle = parseStyle(raw)
    } else if (name === 'onclick') {
      const fn = interpolate(raw, scope)
      if (typeof fn === 'function') props.onClick = fn
    } else if (name === 'class') {
      props.className = interpolate(raw, scope)
    } else {
      props[name] = interpolate(raw, scope)
    }
  }

  const children = renderChildren(el, scope)

  if (hoverStyle) {
    return (
      <HoverEl
        key={props.key as string}
        tag={tag}
        base={baseStyle ?? {}}
        hover={hoverStyle}
        props={props}
      >
        {children}
      </HoverEl>
    )
  }
  if (baseStyle) props.style = baseStyle
  return React.createElement(tag, props, children.length ? children : undefined)
}

export function Dc({ markup, scope }: { markup: string; scope: Scope }) {
  const doc = useMemo(() => new DOMParser().parseFromString(markup, 'text/html'), [markup])
  const root = doc.body.firstElementChild
  if (!root) return null
  keySeq = 0
  return <>{renderNode(root, scope)}</>
}
