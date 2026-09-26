use wasm_bindgen::prelude::*;

/// 占位：后续迁入 Voronoi / 噪声 / 投影批量接口
#[wasm_bindgen]
pub fn add(a: f64, b: f64) -> f64 {
    a + b
}

#[wasm_bindgen]
pub fn project_mercator(lon: f64, lat: f64) -> Vec<f64> {
    let d2r = std::f64::consts::PI / 180.0;
    let lat = lat.max(-85.0).min(85.0);
    let x = lon * d2r;
    let y = ((std::f64::consts::PI / 4.0) + (lat * d2r) / 2.0).tan().ln();
    vec![x, y]
}
