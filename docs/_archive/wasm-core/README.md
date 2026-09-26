# wasm-core（可选热路径）

目标：将 Voronoi 撒点、噪声、投影数学等热路径迁到 Rust → WebAssembly。

## 前置

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack
```

## 构建（示例）

```bash
cd wasm-core
wasm-pack build --target web --out-dir ../web/src/core/wasm
```

## 集成约定

- Web 侧通过 `web/src/core/wasm` 动态 import；失败时回退现有 TS 实现。
- 输入输出用 `Float64Array` / `Uint32Array`，避免每 cell JS 对象跨界。
- **世界真相仍在 TS Core 的 lonlat 结构**；WASM 只加速计算，不单独存档。

## 建议优先迁移

1. `voronoi.ts` 撒点 + Lloyd  
2. `height.ts` 噪声与大陆 stamp  
3. `climate.ts` 逐 cell 场  
4. `project/*.ts` 批量投影  

当前仓库在无 Rust 环境下以 TypeScript 全量实现；本目录为迁移脚手架。
