/**
 * バウチャー用アイコン (public/assets/icons/*.svg) と装飾 (public/assets/decor/*.svg) を、
 * @react-pdf/renderer の Svg / Path 等でベクターのまま描く。
 * データは scripts/build-voucher-icon-data.py が生成する lib/voucher-icons.generated.ts (単一の管理元は SVG)。
 * <Image> にラスター化して渡す方式は採らない (印刷時の拡大で劣化するため)。
 */
import React from "react"
import { Svg, Path, Rect, Circle, Ellipse, Line, G } from "@react-pdf/renderer"
import type { Style } from "@react-pdf/types"
import { VOUCHER_ICONS, type IconNode, type VoucherIconName } from "./voucher-icons.generated"

type Paint = {
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeLinecap?: "butt" | "round" | "square"
  strokeLinejoin?: "miter" | "round" | "bevel"
  strokeDasharray?: string
  fillRule?: "nonzero" | "evenodd"
  opacity?: number
}
function paint(n: IconNode): Paint {
  const p: Paint = {}
  if (n.fill) p.fill = n.fill
  if (n.stroke) p.stroke = n.stroke
  if (n.strokeWidth) p.strokeWidth = Number(n.strokeWidth)
  if (n.strokeLinecap) p.strokeLinecap = n.strokeLinecap as Paint["strokeLinecap"]
  if (n.strokeLinejoin) p.strokeLinejoin = n.strokeLinejoin as Paint["strokeLinejoin"]
  if (n.strokeDasharray) p.strokeDasharray = n.strokeDasharray
  if (n.fillRule) p.fillRule = n.fillRule as Paint["fillRule"]
  if (n.opacity) p.opacity = Number(n.opacity)
  return p
}
function renderNode(n: IconNode, key: number): React.ReactElement | null {
  const p = paint(n)
  switch (n.t) {
    case "path":
      return <Path key={key} d={n.d ?? ""} {...p} />
    case "rect":
      return <Rect key={key} x={n.x ?? 0} y={n.y ?? 0} width={n.width ?? 0} height={n.height ?? 0} rx={n.rx ?? 0} ry={n.ry ?? n.rx ?? 0} {...p} />
    case "circle":
      return <Circle key={key} cx={n.cx ?? 0} cy={n.cy ?? 0} r={n.r ?? 0} {...p} />
    case "ellipse":
      return <Ellipse key={key} cx={n.cx ?? 0} cy={n.cy ?? 0} rx={n.rx ?? 0} ry={n.ry ?? 0} {...p} />
    case "line":
      return <Line key={key} x1={n.x1 ?? 0} y1={n.y1 ?? 0} x2={n.x2 ?? 0} y2={n.y2 ?? 0} {...p} />
    case "g":
      return (
        <G key={key} transform={n.transform} {...p}>
          {(n.c ?? []).map((c, i) => renderNode(c, i))}
        </G>
      )
    default:
      return null
  }
}

/** 64×64 のアイコン。size は pt。color を渡すと単色アイコンの塗り/線をその色に置き換える (白抜き等)。 */
export function VIcon({ name, size, color, style }: { name: VoucherIconName; size: number; color?: string; style?: Style }) {
  const def = VOUCHER_ICONS[name]
  const [, , vw, vh] = def.viewBox
  const nodes = color ? recolor(def.nodes as IconNode[], color) : (def.nodes as IconNode[])
  return (
    <Svg width={size} height={(size * vh) / vw} viewBox={def.viewBox.join(" ")} style={style}>
      {nodes.map((n, i) => renderNode(n, i))}
    </Svg>
  )
}
/** 幅指定で描く装飾 (viewBox 比率を維持)。 */
export function VDecor({ name, width, style }: { name: VoucherIconName; width: number; style?: Style }) {
  const def = VOUCHER_ICONS[name]
  const [, , vw, vh] = def.viewBox
  return (
    <Svg width={width} height={(width * vh) / vw} viewBox={def.viewBox.join(" ")} style={style}>
      {(def.nodes as IconNode[]).map((n, i) => renderNode(n, i))}
    </Svg>
  )
}
// 単色置換: 塗り・線が "none" 以外の要素をすべて color にする (白/赤の穴構造は evenodd で保たれる)
function recolor(nodes: IconNode[], color: string): IconNode[] {
  return nodes.map((n) => {
    const m: IconNode = { ...n }
    if (m.fill && m.fill !== "none") m.fill = color
    if (m.stroke && m.stroke !== "none") m.stroke = color
    if (m.c) m.c = recolor(m.c, color)
    return m
  })
}
export type { VoucherIconName }
