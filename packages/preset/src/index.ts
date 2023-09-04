import Markdown from "reveal.js/plugin/markdown/markdown.esm.js";
import RevealHighlight from "reveal.js/plugin/highlight/highlight.esm.js";
import RevealNotes from "reveal.js/plugin/notes/notes.esm.js";
import RevealSvgTimelineFragment from "reveal.js-svg-timeline-fragment";
import RevealAnimateFragments from "reveal.js-animate-fragments";
import RevealScriptFragment from "reveal.js-script-fragment";
import "@mythosthesia/visualize-rust-code-execution/dist/elements/rust-execution-visualizer.js";

export const plugins = [
  Markdown,
  RevealSvgTimelineFragment,
  RevealNotes,
  RevealScriptFragment,
  RevealAnimateFragments,
  RevealHighlight,
];

export const config = {
  plugins,

  center: false,
  transition: "none",
  highlight: {
    beforeHighlight: (hljs) => {
      hljs.configure({
        ignoreUnescapedHTML: true,
      });
    },
  },
};
