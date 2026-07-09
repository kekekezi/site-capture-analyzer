export function selectorForElement(element: Element): string {
  if (element.id) {
    return `#${cssEscape(element.id)}`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const classes = Array.from(current.classList).slice(0, 2).map((name) => `.${cssEscape(name)}`).join("");
    const parent: Element | null = current.parentElement;
    const children: Element[] = parent ? Array.from(parent.children) : [];
    const siblings = children.filter((child: Element) => child.tagName === current?.tagName);
    const nth = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : "";
    parts.unshift(`${tag}${classes}${nth}`);
    current = parent;
  }

  return parts.join(" > ");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
