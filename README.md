# Grow a Snowflake

An interactive snowflake growth simulation for students, inspired by Veritasium's video [*The Snowflake Myth*](https://www.youtube.com/watch?v=ao2Jfm35XeE) with Ken Libbrecht.

- **Grow:** steer temperature and humidity with the sliders or by dragging the point on the Nakaya morphology diagram (or press *Auto-drift*), and watch the crystal grow on a 601-cell hexagonal grid. The model is a Gravner–Griffeath-style vapour diffusion model; only one 30° wedge is computed, using the 12-fold symmetry. A side view shows plate vs column habit, and you can colour the ice by the temperature or time at which it formed.
- **3D view:** a rotatable three.js model of the grown crystal. The outline and surface ridges come from the top view, and the two are combined: each slice along the c-axis has the side view's width and the top-view outline the crystal had when that slice stopped growing sideways, so capped columns get a hexagonal core and fully branched end plates.
- **True 3D:** grows the crystal on a 3D lattice of stacked hexagonal layers (after Gravner & Griffeath's 3D model), so thickness, ridges, hollow columns, needles and capped columns come out of the model itself. Shown in perspective (rotatable) next to an orthographic top view of the same crystal, with its own diagram, presets and journeys. Slower: about 300 cells across, 1–2 minutes per crystal.
- **Paper snowflake:** turns the grown crystal into a simplified, printable 30° cutting template for a six-point folded paper snowflake, with folding instructions and a preview.

Files: `index.html` (app plus 2D and 3D growth models), `snow3d.js` (3D view of the 2D model), `true3d.js` (True 3D tab), and `vendor/three/` (three.js r187, MIT licence, bundled so the page works without a CDN).
