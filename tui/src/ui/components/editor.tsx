import type { TextareaRenderable } from "@opentui/core"
import { useImperativeHandle, useRef, type Ref } from "react"
import type { Keymap } from "../../config/keybinds.ts"
import { describe } from "../../config/keybinds.ts"
import type { Theme } from "../../config/theme.ts"

export type EditorHandle = {
  /** Current text, for submitting or for computing completions. */
  text: () => string
  clear: () => void
  /** Replaces the whole buffer, used when a picker inserts a completion. */
  set: (text: string) => void
  insert: (text: string) => void
}

export function Editor({
  theme,
  keymap,
  busy,
  handle,
  onSubmit,
}: {
  theme: Theme
  keymap: Keymap
  busy: boolean
  handle: Ref<EditorHandle>
  onSubmit: (text: string) => void
}) {
  const ref = useRef<TextareaRenderable>(null)

  useImperativeHandle(handle, () => ({
    text: () => ref.current?.plainText ?? "",
    clear: () => ref.current?.editBuffer.setText(""),
    set: (text: string) => ref.current?.editBuffer.setText(text),
    insert: (text: string) => ref.current?.editBuffer.insertText(text),
  }))

  return (
    <box
      style={{
        border: true,
        borderColor: busy ? theme.warning : theme.border,
        backgroundColor: theme.panel,
        minHeight: 3,
        maxHeight: 10,
        paddingLeft: 1,
        paddingRight: 1,
        width: "100%",
      }}
    >
      <textarea
        ref={ref}
        focused={!busy}
        placeholder={busy ? `working… ${describe(keymap.interrupt)} to stop` : "ask jarvis, or /help"}
        placeholderColor={theme.muted}
        textColor={theme.fg}
        backgroundColor={theme.panel}
        focusedBackgroundColor={theme.panel}
        cursorColor={theme.accent}
        wrapMode="word"
        keyBindings={[
          { ...keymap.submit, action: "submit" },
          { ...keymap.newline, action: "newline" },
          { name: "j", ctrl: true, action: "newline" },
        ]}
        onSubmit={() => {
          const text = ref.current?.plainText ?? ""
          if (!text.trim()) return
          ref.current?.editBuffer.setText("")
          onSubmit(text)
        }}
        style={{ flexGrow: 1 }}
      />
    </box>
  )
}
