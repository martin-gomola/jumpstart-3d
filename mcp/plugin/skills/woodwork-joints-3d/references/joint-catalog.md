# Joint catalog

FDM rating 1–5 rates printability on a Bambu Lab X2D (0.4 mm nozzle,
0.20 mm layer, PLA): can the joint print flat without supports and does its
critical load path lie in the XY plane? `T` is the material thickness.

## Western joints

| Joint | Geometry | FDM | Loads / weakness |
| --- | --- | --- | --- |
| Through dovetail | slope α = arctan(1/7) ≈ 8.13° (structural) or arctan(1/8) ≈ 7.13° (drawers); pin width at narrow end p ≥ T/4; depth L = T | 5 | self-locking in tension perpendicular to slide; weak along slide axis |
| Sliding dovetail | same slope; groove length L ≥ 1.5·T; print groove opening upward | 5 | shear across groove; needs end key to prevent slide-out |
| Through mortise and tenon | tenon_thk = T/3; tenon_width ≥ 2·tenon_thk; L = full pass + 5–10 mm key stub | 4 | fails in pure tension without a key |
| Tusk / keyed tenon | through tenon + cross mortise behind shoulder; **offset 1.5 mm toward shoulder**; wedge taper 1:8 to 1:10 (6–7°) | 5 | self-locking in tension and compression; demountable; ideal FDM joint |
| Draw-bored M&T | tenon T/3; hole offset in tenon **1.0 mm** (reduced from 1.5 mm for PLA brittleness); tapered pin 1:12 | 4 | tension self-locking; pin in Z axis may delaminate under cyclic bending |
| Through-wedged tenon | kerf stop hole L/4 from shoulder; mortise flares 3–5° outward; fox-wedge kerfs 4.8 mm from edge | 4 | tension; add R 0.5 fillet at kerf root to prevent PLA tearing |
| Haunched tenon | tenon T/3, haunch h = T/4 into edge groove | 4 | resists frame racking; needs chamfer on haunch floor |
| Twin / double tenon | 2× tenon t = T/5, gap g = T/5 | 4 | torsion; more critical edges to adapt |
| Half-lap | both parts cut to T/2; keyed variant with 75° dovetail key | 4 keyed / 2 bare | shear; weak in torsion without key |
| Half-blind dovetail | slope 1:8; socket depth 2·T/3; outer wall T/3 | 3 | socket ceiling overhang needs FDM adaptation |
| Blind mortise and tenon | mortise 1.5 mm deeper than tenon; tenon T/3 | 3 | mortise ceiling is unsupported; print upside down or convert to through |
| Mitered spline | 45° miter + spline slot w = T/4, d = T/3 | 4 | spline printed separately, flat orientation |
| Miter | 45° only | 2 | end-grain analog = layer end; always add a spline |
| Dowel joint | d_dowel = T/3, L = 2.5·d | 2 | tiny contact area; delaminates in Z axis |

## Japanese joints (names and translations from *The Complete Japanese Joinery*)

| Japanese name | English translation (book) | FDM | Notes |
| --- | --- | --- | --- |
| **Kanawa tsugi** 金輪継 | Half blind tenoned, dadoed and rabbetted scarf joint | 5 | T-shaped half-blind tenon at both ends; **15 mm² pin hole at centre**; L = 3 to 3.5 × width. Best choice for splicing an oversized part. |
| Shiribasami / Shippasami tsugi | Blinded and stubbed, dadoed and rabbetted scarf joint | 4 | Pin not visible on surface; L = 3–3.5 × W |
| Okkake daisen tsugi 追掛け大栓継 | Dadoed and rabbetted scarf joint | 4 | Parts slide into each other; secured by a cross-pin |
| **Shachi tsugi** 車知継 | Key haunch mortise and tenon | 5 | Key slot angled toward centre, or use a tapered key. Used where parts cannot be slid together. Four slot-cutting methods documented. |
| Hako shachi tsugi 箱車知継 | L-shaped, dadoed and rabbetted and keyed lapped joint | 4 | Right-angle Shachi for cabinet corners |
| Koshikake ari tsugi 腰掛蟻継 | Lapped dovetail joint | 5 | Standard mudsill / beam splice; `lap_width = lap_depth = T/8` |
| Koshi-ire mechigai-zuki ari tsugi | Half-lapped, half blind tenoned dovetail joint | 4 | Dovetail + hidden tenon for concealed corners |
| Kama tsugi 鎌継 | Gooseneck joint | 4 | For situations where parts cannot be slid |
| Mechigai hozotsuki kama tsugi | Half blind mortised and tenoned gooseneck joint | 3 | Gooseneck plus hidden tenon; thin gooseneck tip is fragile in PLA |
| Mechigai tsugi 目違継 | Mortise and tenon (generic) | 4 | `mechigai ire` = mortise part; `mechi hozo` = tenon part |
| Hako mechigai tsugi 箱目違継 | Blind U-shaped stubbed mortise and tenon | 3 | Blind U-shape; needs ceiling adaptation |
| Kaneori mechigai tsugi 曲折目違継 | L-shaped half blind mortise and tenon | 3 | Right-angle half-blind variant |
| Jyuji mechigai tsugi 十字目違継 | Cross-shaped mortise and tenon | 4 | Cross-through of two members |
| Hakodai-mochi tsugi 箱台持継 | Shipped and pinned and halved half lap joint | 3 | Related to hako-mechigai family |
| Kabuto ari 兜蟻 | End lap joint with dovetail | 4 | Right-angle for do-sashi beams and mudsills |
| Watari ago 渡顎 | Dadoed cross lap joint | 4 | Right-angle / cross intersection |
| Hozo sashi ホゾ差 | Mortise and tenon (generic category) | 4 | Variants include `aire tan hozo sashi` (dadoed short tenon) and `nosekake` |

Fasteners used by Japanese joints:

- **Komisen** 込栓 — pin
- **Shachisen** 車知栓 — tapered key / wedge-pin
- **Hanasen** 鼻栓 — nose pin
- **Kusabi** 楔 — wedge (used in pairs as folding wedges)

Book terminology distinction: **tsugite** 継手 = end joints (I-axis splices,
extending a member) and **shiguchi** 仕口 = right-angle joints (L-axis corners
and crossings).

Not in this book, flagged for future sourcing: *Sashimono* 指物 (fine
cabinetmaking joinery) and *Shachihoko* (decorative roof element) are not
covered — the book is strictly a carpentry reference for mudsills, girders,
columns and roof framing.
