window.__ModuleLoader__.load({
  id: "dsh-tokenizer",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    let React = require("react");

    // Color thresholds, in tokens. This vocabulary runs ~1.5-1.7 Chinese chars per token,
    // so 100 ≈ 160 chars (a long-ish message) and 500 ≈ 800 chars (a deliberate paste).
    // The draft never gets near the model window, so red means "are you sure you meant to
    // paste this much", not "the context is filling up".
    const GREEN_MAX = 100;
    const YELLOW_MAX = 500;

    function TokenCounter({ useInput }) {
      const state = useInput ? useInput((s) => s) : null;
      const draft = state && typeof state.draft === "string" ? state.draft : "";

      const [result, setResult] = React.useState(null);
      const timerRef = React.useRef(null);
      const seqRef = React.useRef(0);

      React.useEffect(() => {
        if (!draft) {
          setResult(null);
          return;
        }

        if (timerRef.current) clearTimeout(timerRef.current);

        const mySeq = ++seqRef.current;
        timerRef.current = setTimeout(async () => {
          try {
            const response = await fetch("/dsh-tokenizer/count", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ text: draft })
            });
            const data = await response.json();
            if (seqRef.current !== mySeq) return;
            if (data && data.ok) {
              setResult(data.value);
            } else {
              setResult(null);
            }
          } catch {
            if (seqRef.current === mySeq) setResult(null);
          }
        }, 500);

        return () => {
          if (timerRef.current) clearTimeout(timerRef.current);
        };
      }, [draft]);

      const text = result
        ? `${result.tokens} toks，${result.chars} chars`
        : draft
          ? "…"
          : "";
      const color = result
        ? result.tokens < GREEN_MAX
          ? "#22c55e"
          : result.tokens < YELLOW_MAX
            ? "#f59e0b"
            : "#ef4444"
        : "rgba(128, 128, 128, 0.75)";


      if (!text) return null;

      return React.createElement(
        "div",
        {
          style: {
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px 0",
            fontSize: 14,
            lineHeight: "18px",
            color: "var(--dsw-alias-label-tertiary, rgba(128,128,128,.75))",
            userSelect: "none",
            pointerEvents: "none"
          }
        },
        React.createElement(
          "span",
          {
            style: {
              display: "inline-block",
              width: "0.8em",
              height: "0.8em",
              borderRadius: "50%",
              backgroundColor: color,
              flex: "none"
            }
          }
        ),
        text
      );
    
    
    }

    function apply(ctx) {
      ctx.slots.inject(
        "conversation.input.right",
        () => ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "dsh-tokenizer-count-right",
            order: 100
          },
          TokenCounter
        )
      );
    }

    module.exports = {
      apply,
      inject: ["slots"]
    };
    return module.exports;
  }
});
