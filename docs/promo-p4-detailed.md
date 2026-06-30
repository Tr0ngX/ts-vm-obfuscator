# Video #4 — "Self-Modifying Code" — Prompt Cực Chi Tiết

> Dùng cho: Veo 3.1 / Runway Gen-3 / Pika / Kling / Sora
> Duration: 10 giây
> Aspect ratio: 9:16 (1080×1920) — TikTok / Shorts / Reels
> Style: Cyberpunk dark tech, glitch, cinematic

---

## Prompt Chính (Copy-paste thẳng vào AI)

```
Cinematic 9:16 vertical video, dark cyberpunk glitch aesthetic.
A single hexagonal shield made of bytecode, floating in dark void — the SAME shield from Part 3.
Zoomed in close. The bytecode hex numbers "0xD1 0x8E 0xC7" are INSIDE the shield, constantly shifting.
Each time a bytecode number glows, it gets corrupted by a neon red XOR mask "0xFF" flashing over it.
The bytecode becomes garbage "0x2E 0x71 0x38" for a split second.
Then a green recovery pulse sweeps across the shield and the original hex restores.
On the right side, a dark terminal window shows "MEMORY DUMP" — it only captures garbage hex, never the real bytecode.
The shield continues rotating, corrupting and recovering in a seamless loop.
Lighting: purple shield glow from center, red flash on corruption, green flash on recovery.
Camera: slow macro push-in, tight on the bytecode corruption cycle.
Atmosphere: glitch artifacts, floating particles, digital scanlines.
Mood: alive, adaptive, uncrackable.
No hands, no characters, no destruction.
--ar 9:16 --style raw
```

---

## Phân Tách Từng Yếu Tố

### 1. Composition & Camera

| Yếu tố | Chi tiết |
|---|---|
| **Frame** | 9:16 vertical (1080×1920) |
| **Shot type** | Macro close-up — chỉ thấy shield và bytecode bên trong |
| **Camera movement** | Slow push-in từ medium → extreme close-up trên bytecode |
| **Depth of field** | Shallow, chỉ bytecode đang corrupt là sharp |
| **Focus rack** | Focus nhảy giữa các bytecode khác nhau khi corrupt |

### 2. Lighting

| Light | Màu | Vị trí | Mục đích |
|---|---|---|---|
| **Base glow** | Tím #aa00ff | Từ shield | Trạng thái bình thường |
| **Corruption flash** | Đỏ #ff0030 | Toàn màn hình | Khi XOR mask tấn công |
| **Recovery pulse** | Xanh lá #00ff88 | Quét từ trái sang phải | Khi bytecode phục hồi |
| **Terminal screen** | Xanh lá #00cc00 | Góc phải | Memory dump output |
| **Volumetric** | Khói tím nhẹ | Xung quanh shield | Tạo chiều sâu |

### 3. Objects & Elements

| Element | Mô tả |
|---|---|
| **Hex shield** | Giống shield trung tâm (tím) từ Part 3 — continuity link |
| **Bytecode inside** | `0xD1 0x8E 0xC7` — các con số hex sống, tự động xoay chuyển |
| **XOR mask** | `0xFF` màu đỏ flash chồng lên bytecode, tượng trưng cho LCG rolling key |
| **Garbage bytes** | `0x2E 0x71 0x38` — byte đã bị corrupt, xuất hiện trong 0.5s |
| **Recovery wave** | Sóng xanh lá quét ngang shield, bytecode gốc trở lại |
| **Terminal** | Cửa sổ "MEMORY DUMP" bên phải, chỉ hiện garbage hex |
| **Timeline indicator** | Progress bar nhỏ dưới shield "FETCH → CORRUPT → RECOVER" |

### 4. Time-based Animation (10s)

| Time | Event |
|---|---|
| **00 - 01s** | Continuity: Shield tím từ Part 3, xoay bình thường |
| **01 - 02s** | Camera push-in, focus vào bytecode bên trong |
| **02 - 04s** | Bytecode `0xD1` glow đỏ → XOR mask `0xFF` flash → thành `0x2E` |
| **04 - 05s** | Memory dump terminal bên phải hiện garbage, camera giật nhẹ |
| **05 - 07s** | Sóng xanh lá quét từ trái sang phải, bytecode phục hồi |
| **07 - 09s** | Bytecode tiếp theo bị corrupt, cycle lặp lại (0x8E → 0x71) |
| **09 - 10s** | Camera pull-back, cycle vẫn tiếp tục, text "SELF-MODIFYING" xuất hiện |

### 5. Text Overlay (Add sau trong editing)

| Nội dung | Font | Hiệu ứng | Vị trí |
|---|---|---|---|
| `PHẦN 3: TRUE POLYMORPHISM` | JetBrains Mono | Fade out | Góc trên trái |
| `PHẦN 4: SELF-MODIFYING` | JetBrains Mono Bold | Glitch | Góc trên trái |
| `FETCH → CORRUPT → RECOVER` | JetBrains Mono | Typewriter, 1 dòng | Dưới shield |
| `MEMORY DUMP: 0x2E 0x71 0x38` | Courier New | Terminal style, green | Góc phải |
| `"Self-Modifying Bytecode"` | JetBrains Mono Bold | Fade in cuối | Center |
| `TSXobf` | Inter Light | Opacity 30% | Góc dưới phải |
| `#4 / 7` | JetBrains Mono | Opacity 50% | Góc trên phải |

### 6. Âm Thanh (Add sau)

| Time | Sound |
|---|---|
| 00-01s | Ambient hum (kết nối từ Part 3) |
| 01-02s | Camera zoom whoosh + focus beep |
| 02-04s | Glitch điện tử *zzt* *crackle* khi XOR mask tấn công |
| 04-05s | Terminal beep + dòng chữ hiện ra |
| 05-07s | Synth sweep lên (recovery wave), âm thanh "chữa lành" |
| 07-09s | Glitch lặp lại, nhưng quen thuộc hơn |
| 09-10s | Bass nhẹ, "self-modifying" text xuất hiện |

### 7. Negative Prompt

```
bright, cartoon, realistic human, hands, people, violence, explosion, fire, weapon,
oversaturated, anime, low contrast, flat lighting, static unchanging, boring loop,
complete darkness, invisible subject
```

---

## Prompt Ngắn (cho AI giới hạn ký tự)

```
9:16 vertical, dark glitch cyberpunk. Close-up of purple hexagonal bytecode shield from Part 3.
Bytecode "0xD1 0x8E 0xC7" inside constantly XOR-corrupted by red flash "0xFF", becomes garbage "0x2E",
then green recovery wave restores it. Terminal on right shows "MEMORY DUMP: garbage hex".
Camera macro push-in. No hands, no destruction.
```

---

## Liên Kết Cốt Truyện

```
Part 1: "AST là khóa nhựa"          → Ổ khóa code Vỡ
Part 2: "Bytecode VM"                → Code → Compiler → SHIELD
Part 3: "TRUE POLYMORPHISM"          → 1 SHIELD → 3 SHIELD khác nhau
Part 4: "SELF-MODIFYING"             → SHIELD tự corrupt/recover LIÊN TỤC
                                           ↓
Part 5: "Selective Virtualization"   → Chỉ hàm @virtualize mới vào SHIELD
```

### Continuity visual:
- **Part 3** kết thúc: 3 shield với 3 màu (xanh dương / tím / xanh lá)
- **Part 4** mở đầu: Zoom vào shield TÍM (trung tâm) — cùng shield đó
- **Color evolution**: Tím (trạng thái) → Đỏ (corrupt) → Xanh lá (recover) → Tím (ổn định)

### Narration cho Part 4 (10s):

> "Phần 3: mỗi build VM khác nhau. Nhưng còn hơn thế: bytecode tự XOR corrupt sau mỗi opcode fetch. Memory dump chỉ thấy rác. Chỉ VM mới recover được. Phần 5: ảo hóa có chọn lọc."

### English:

> "Part 3: every build different. But more than that: bytecode self-corrupts after each opcode fetch. Memory dump sees garbage. Only the VM can recover. Part 5: selective virtualization."
