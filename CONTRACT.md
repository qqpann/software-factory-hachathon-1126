# ゲームの契約（Game Contract）

工場が作るゲームはすべてこの契約を守る。評価器はジャンルを知らず、この契約だけを頼りに遊ぶ。

## 形
- `index.html` 1枚で完結する。外部のスクリプト・画像・フォント・CDN・通信は使わない（画像や音は手続き生成かdata URL）。
- 960×720 のビューポートで全体が見える。
- アニメーションは `requestAnimationFrame` / `setTimeout` / `performance.now()` を使う（評価器が時間を止めたり進めたりできるように）。

## 状態フック
ページは常に `window.__game` を公開する。

```js
window.__game = {
  state: 'title',   // 'title' | 'playing' | 'won' | 'lost'
  score: 0,         // 有限の数値
  title: 'ゲーム名',
  goal: '何をすれば勝ちか（1文）',
  controls: '操作方法（1文）',
};
```

- `state` と `score` はゲームの進行に合わせて更新し続ける。
- タイトル画面で **Space か Enter** を押すと `playing` になる。
- `won` / `lost` のあと **Space か Enter** で最初からやり直せる。
- 画面にも、遊び方と勝ち負けが文字で分かるように表示する。
