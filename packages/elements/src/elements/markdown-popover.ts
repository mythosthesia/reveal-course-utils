import { css, html, LitElement } from "lit";
import { marked } from "marked";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { property, customElement } from "lit/decorators.js";

@customElement("markdown-popover")
export class MarkdownPopover extends LitElement {
  @property()
  content: string | undefined;

  render() {
    if (this.content) return html`${unsafeHTML(marked.parse(this.content))}`;
    return html`<slot></slot>`;
  }

  static styles = css`
    :host {
      position: absolute;
      background-color: #4d4d4d;
      padding: 1rem;
      box-shadow: 0 2px 5px 0 rgba(0, 0, 0, 0.26);
      border-radius: 10px;
      width: auto;
      transform: translate(16px, -15px);
      max-width: 600px;
      white-space: break-spaces;
      display: inline-flex;
    }
    :host:after {
      content: "";
      position: absolute;
      top: 6px;
      left: -8px;
      border-style: solid;
      border-width: 18px 12px 0;
      border-color: #4d4d4d transparent;
      display: block;
      width: 0;
      z-index: 1;
      transform: translate(-50%, 50%) rotate(90deg);
    }

    p {
      padding: 0 !important;
      margin: 0 !important;
    }

    ul {
      padding: 0 !important;
      padding-left: 8px !important;
      display: grid !important;
      margin: 0 !important;
    }

    slot {
      color: white !important;
    }
  `;
}