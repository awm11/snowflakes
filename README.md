# Grow a Snowflake

An interactive snowflake growth simulation for students, inspired by Veritasium's video [*The Snowflake Mystery*](https://www.youtube.com/watch?v=ao2Jfm35XeE) with Ken Libbrecht.

- **Grow:** steer temperature and humidity with the sliders or by dragging the point on the Nakaya morphology diagram (or press *Auto-drift*), and watch the crystal grow on a 601-cell hexagonal grid. The model is a Gravner–Griffeath-style vapour diffusion model; only one 30° wedge is computed, using the 12-fold symmetry. A side view shows plate vs column habit, and you can colour the ice by the temperature or time at which it formed.
- **3D view:** a rotatable three.js model of the grown crystal. Plate thickness is a qualitative model: thickest at the centre and along the ribs, tapering to razor-thin edges, and thinner for ice that grew near −15 °C. The column structure comes from the side-view model.
- **Paper snowflake:** turns the grown crystal into a simplified, printable 30° cutting template for a six-point folded paper snowflake, with folding instructions and a preview.

Files: `index.html` (app and growth model), `snow3d.js` (3D view), and `vendor/three/` (three.js r187, MIT licence, bundled so the page works without a CDN).
