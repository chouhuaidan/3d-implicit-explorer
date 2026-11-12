// ============================================
// Application Logic & UI
// ============================================
// Ties together the LaTeX parser, renderer, and camera.
// Handles UI events, settings management, and the render loop.

(function() {
    'use strict';

    // ---- Default settings ----
    const DEFAULT_SETTINGS = {
        resolution: 0.5,
        lightBrightness: 1.2,
        maxDistance: 50.0,
        stepSize: 0.05,
        bisectionSteps: 16,
        ambientLight: 0.15,
        fogDensity: 0.02,
        showAxes: true,
        surfaceColorMode: 0,
        surfaceColor: [0.8, 0.8, 0.8],
        specularStrength: 0.5,
        epsilon: 0.001,
        maxSteps: 1000,
        fov: 70.0,
        depthFalloffType: 0,
        depthMaxDistance: 30.0,
        depthExpDecay: 0.05,
        depthInvert: false,
        depthVoidMode: 0,
        depthLighting: false
    };

    // ---- Example equations ----
    const EXAMPLES = [
        { name: 'Sphere', latex: 'x^2+y^2+z^2=1' },
        { name: 'Torus', latex: '\\left(\\sqrt{x^2+z^2}-2\\right)^2+y^2=0.5' },
        { name: 'Gyroid', latex: '\\sin(x)\\cos(y)+\\sin(y)\\cos(z)+\\sin(z)\\cos(x)=0' },
        { name: 'Schwarz P', latex: '\\cos(x)+\\cos(y)+\\cos(z)=0' },
        { name: 'Cylinder', latex: 'x^2+z^2=1' },
        { name: 'Cone', latex: 'x^2+z^2-y^2=0' },
        { name: 'Hyperboloid', latex: 'x^2-y^2+z^2=1' },
        { name: 'Sine Waves', latex: '\\sin(x)+\\sin(y)+\\sin(z)=1' },
        { name: 'Complex (GCD)', latex: '\\cos\\left(y\\right)2^{x\\sin\\left(x\\right)}=\\log_{2}\\left(\\gcd\\left(z,x\\right)\\right)' },
        { name: 'Tangled Cube', latex: 'x^{4}-5x^{2}+y^{4}-5y^{2}+z^{4}-5z^{2}+11.8=0' },
        { name: 'Heart', latex: '\\left(x^2+\\frac{9}{4}y^2+z^2-1\\right)^3-x^2z^3-\\frac{9}{80}y^2z^3=0' },
        { name: 'Cassini', latex: '\\left(x^2+y^2+z^2+0.45^2\\right)^2-4\\cdot0.45^2\\left(x^2+z^2\\right)=0.1' },
        { name: 'Lattice', latex: '\\cos(x)\\cos(y)\\cos(z)=0.3' },
        { name: 'GCD Surface', latex: '\\gcd(x,z)=y' },
        { name: 'Floor Stairs', latex: 'y=\\floor(x)+\\floor(z)' },
    ];

    let app = null;

    class App {
        constructor() {
            this.canvas = document.getElementById('glCanvas');
            this.camera = new window.FPSCamera();
            this.renderer = null;
            this.settings = { ...DEFAULT_SETTINGS };
            this.lastTime = 0;
            this.fps = 0;
            this.frameCount = 0;
            this.fpsTime = 0;
            this.currentLatex = '';
            this.isRunning = false;
        }

        init() {
            // Initialize renderer
            this.renderer = new window.ImplicitRenderer(this.canvas);
            
            // Initialize camera
            this.camera.init(this.canvas);

            // Setup UI
            this._setupUI();
            this._setupExamples();
            this._setupSettings();

            // Handle resize
            window.addEventListener('resize', () => this._resize());
            this._resize();

            // Load equation and camera from URL parameters or default
            const urlParams = new URLSearchParams(window.location.search);
            const eqParam = urlParams.get('eq');
            const posParam = urlParams.get('pos');
            if (posParam) {
                const parts = posParam.split(',').map(Number);
                if (parts.length === 3 && !parts.some(isNaN)) {
                    this.camera.setPosition(parts[0], parts[1], parts[2]);
                }
            }
            const modeParam = urlParams.get('mode');
            if (modeParam !== null) {
                this.settings.surfaceColorMode = parseInt(modeParam);
                const cm = document.getElementById('colorModeSelect');
                if (cm) cm.value = modeParam;
                const ds = document.getElementById('distanceShadingSection');
                if (ds) ds.style.display = (modeParam === '3') ? 'block' : 'none';
            }
            const falloffParam = urlParams.get('falloff');
            if (falloffParam !== null) {
                const fMode = parseInt(falloffParam);
                this.settings.depthFalloffType = fMode;
                const df = document.getElementById('depthFalloffSelect');
                if (df) df.value = falloffParam;
                const mr = document.getElementById('depthMaxDistRow');
                const er = document.getElementById('depthExpDecayRow');
                if (mr) mr.style.display = (fMode === 0) ? 'flex' : 'none';
                if (er) er.style.display = (fMode === 1) ? 'flex' : 'none';
            }
            const invertParam = urlParams.get('invert');
            if (invertParam !== null) {
                this.settings.depthInvert = (invertParam === '1' || invertParam === 'true');
                const di = document.getElementById('depthInvertCheck');
                if (di) di.checked = this.settings.depthInvert;
            }
            const maxDistParam = urlParams.get('maxdist');
            if (maxDistParam !== null) {
                this.settings.depthMaxDistance = parseFloat(maxDistParam);
                const sl = document.getElementById('depthMaxDistSlider');
                const val = document.getElementById('depthMaxDistValue');
                if (sl) sl.value = maxDistParam;
                if (val) val.textContent = maxDistParam;
            }
            const decayParam = urlParams.get('decay');
            if (decayParam !== null) {
                this.settings.depthExpDecay = parseFloat(decayParam);
                const sl = document.getElementById('depthExpDecaySlider');
                const val = document.getElementById('depthExpDecayValue');
                if (sl) sl.value = decayParam;
                if (val) val.textContent = parseFloat(decayParam).toFixed(3);
            }
            this._setEquation(eqParam || EXAMPLES[0].latex);

            // Start render loop
            this.isRunning = true;
            this.lastTime = performance.now();
            requestAnimationFrame((t) => this._renderLoop(t));
        }

        _renderLoop(timestamp) {
            if (!this.isRunning) return;

            const deltaTime = (timestamp - this.lastTime) / 1000;
            this.lastTime = timestamp;

            // Update FPS counter
            this.frameCount++;
            this.fpsTime += deltaTime;
            if (this.fpsTime >= 0.5) {
                this.fps = Math.round(this.frameCount / this.fpsTime);
                this.frameCount = 0;
                this.fpsTime = 0;
                document.getElementById('fpsDisplay').textContent = this.fps + ' FPS';
            }

            // Update camera
            this.camera.update(deltaTime);

            // Update position display
            const pos = this.camera.getPosition();
            document.getElementById('posDisplay').textContent = 
                `(${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)})`;

            // Render
            this.renderer.render(
                this.camera.getPosition(),
                this.camera.getRotationMatrix(),
                this.settings
            );

            requestAnimationFrame((t) => this._renderLoop(t));
        }

        _resize() {
            const w = window.innerWidth;
            const h = window.innerHeight;
            this.canvas.style.width = w + 'px';
            this.canvas.style.height = h + 'px';
            
            if (this.renderer) {
                this.renderer.resize(w, h);
            }
        }

        _setEquation(latex) {
            this.currentLatex = latex;
            document.getElementById('latexInput').value = latex;

            // Parse LaTeX to GLSL
            const result = window.latexToGLSL(latex);
            
            const errorEl = document.getElementById('errorDisplay');
            const glslPreview = document.getElementById('glslPreview');

            if (result.error) {
                errorEl.textContent = 'Parse error: ' + result.error;
                errorEl.style.display = 'block';
                if (glslPreview) glslPreview.textContent = '';
                return;
            }

            // Show GLSL preview
            if (glslPreview) {
                const preview = 'f(x,y,z) = ' + result.glsl;
                glslPreview.textContent = result.helpers ? result.helpers + '\n\n' + preview : preview;
            }

            // Update renderer
            const compileResult = this.renderer.updateEquation(result.glsl, result.helpers);
            
            if (!compileResult.success) {
                errorEl.textContent = 'Shader error: ' + compileResult.error;
                errorEl.style.display = 'block';
            } else {
                errorEl.style.display = 'none';
            }
        }

        _setupUI() {
            const self = this;

            // Equation input
            const input = document.getElementById('latexInput');
            const goBtn = document.getElementById('goBtn');
            
            const applyEquation = () => {
                const overlay = document.getElementById('startOverlay');
                if (overlay) overlay.style.display = 'none';
                self._setEquation(input.value);
            };
            
            goBtn.addEventListener('click', applyEquation);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    applyEquation();
                    e.preventDefault();
                }
                e.stopPropagation(); // Prevent camera movement while typing
            });
            input.addEventListener('keyup', (e) => e.stopPropagation());
            input.addEventListener('keypress', (e) => e.stopPropagation());

            // Settings toggle
            const settingsBtn = document.getElementById('settingsToggle');
            const settingsPanel = document.getElementById('settingsPanel');
            settingsBtn.addEventListener('click', () => {
                settingsPanel.classList.toggle('open');
            });

            // Help toggle
            const helpBtn = document.getElementById('helpToggle');
            const helpPanel = document.getElementById('helpPanel');
            helpBtn.addEventListener('click', () => {
                helpPanel.classList.toggle('open');
            });

            // Close help on Escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    helpPanel.classList.remove('open');
                    settingsPanel.classList.remove('open');
                    if (document.pointerLockElement) {
                        document.exitPointerLock();
                    }
                }
            });

            // Close panels when entering fly mode
            self.canvas.addEventListener('click', () => {
                helpPanel.classList.remove('open');
                settingsPanel.classList.remove('open');
            });

            // Reset camera button
            document.getElementById('resetCameraBtn').addEventListener('click', () => {
                self.camera.reset();
            });

            // Jump to origin button
            const jumpOriginBtn = document.getElementById('jumpOriginBtn');
            if (jumpOriginBtn) {
                jumpOriginBtn.addEventListener('click', () => {
                    self.camera.setPosition(0, 0, 0);
                });
            }
        }

        _setupExamples() {
            const container = document.getElementById('examplesList');
            const self = this;
            
            EXAMPLES.forEach(ex => {
                const btn = document.createElement('button');
                btn.className = 'example-btn';
                btn.textContent = ex.name;
                btn.title = ex.latex;
                btn.addEventListener('click', () => {
                    const overlay = document.getElementById('startOverlay');
                    if (overlay) overlay.style.display = 'none';
                    self._setEquation(ex.latex);
                });
                container.appendChild(btn);
            });
        }

        _setupSettings() {
            const self = this;

            // Resolution slider
            this._bindSlider('resolutionSlider', 'resolutionValue', 
                (v) => {
                    self.settings.resolution = parseFloat(v);
                },
                (v) => Math.round(v * 100) + '%'
            );

            // Field of view slider
            this._bindSlider('fovSlider', 'fovValue',
                (v) => { self.settings.fov = parseFloat(v); },
                (v) => v + '°'
            );

            // Light brightness
            this._bindSlider('lightSlider', 'lightValue',
                (v) => { self.settings.lightBrightness = parseFloat(v); },
                (v) => parseFloat(v).toFixed(1)
            );

            // Ambient light
            this._bindSlider('ambientSlider', 'ambientValue',
                (v) => { self.settings.ambientLight = parseFloat(v); },
                (v) => parseFloat(v).toFixed(2)
            );

            // Max distance
            this._bindSlider('maxDistSlider', 'maxDistValue',
                (v) => { self.settings.maxDistance = parseFloat(v); },
                (v) => parseFloat(v).toFixed(0)
            );

            // Step size
            this._bindSlider('stepSizeSlider', 'stepSizeValue',
                (v) => { self.settings.stepSize = parseFloat(v); },
                (v) => parseFloat(v).toFixed(3)
            );

            // Bisection steps
            this._bindSlider('bisectionSlider', 'bisectionValue',
                (v) => { self.settings.bisectionSteps = parseInt(v); },
                (v) => v
            );

            // Max steps
            this._bindSlider('maxStepsSlider', 'maxStepsValue',
                (v) => { self.settings.maxSteps = parseInt(v); },
                (v) => v
            );

            // Fog density
            this._bindSlider('fogSlider', 'fogValue',
                (v) => { self.settings.fogDensity = parseFloat(v); },
                (v) => parseFloat(v).toFixed(3)
            );

            // Specular strength
            this._bindSlider('specularSlider', 'specularValue',
                (v) => { self.settings.specularStrength = parseFloat(v); },
                (v) => parseFloat(v).toFixed(2)
            );

            // Normal epsilon
            this._bindSlider('epsilonSlider', 'epsilonValue',
                (v) => { self.settings.epsilon = parseFloat(v); },
                (v) => parseFloat(v).toFixed(4)
            );

            // Move speed
            this._bindSlider('speedSlider', 'speedValue',
                (v) => { self.camera.moveSpeed = parseFloat(v); },
                (v) => parseFloat(v).toFixed(1)
            );

            // Mouse sensitivity
            this._bindSlider('sensitivitySlider', 'sensitivityValue',
                (v) => { self.camera.mouseSensitivity = parseFloat(v); },
                (v) => parseFloat(v).toFixed(4)
            );

            // Invert Y
            const invertYCheck = document.getElementById('invertYCheck');
            if (invertYCheck) {
                invertYCheck.addEventListener('change', function() {
                    self.camera.invertY = this.checked;
                });
            }

            // Show axes
            document.getElementById('showAxesCheck').addEventListener('change', function() {
                self.settings.showAxes = this.checked;
            });

            // Surface color mode
            const colorModeSelect = document.getElementById('colorModeSelect');
            const solidColorRow = document.getElementById('solidColorRow');
            const distanceSection = document.getElementById('distanceShadingSection');
            if (colorModeSelect) {
                colorModeSelect.addEventListener('change', function() {
                    self.settings.surfaceColorMode = parseInt(this.value);
                    if (solidColorRow) {
                        solidColorRow.style.display = (this.value === '2') ? 'flex' : 'none';
                    }
                    if (distanceSection) {
                        distanceSection.style.display = (this.value === '3') ? 'block' : 'none';
                    }
                });
            }

            // Solid color picker
            const surfaceColorPicker = document.getElementById('surfaceColorPicker');
            if (surfaceColorPicker) {
                surfaceColorPicker.addEventListener('input', function() {
                    const hex = this.value;
                    const r = parseInt(hex.slice(1, 3), 16) / 255.0;
                    const g = parseInt(hex.slice(3, 5), 16) / 255.0;
                    const b = parseInt(hex.slice(5, 7), 16) / 255.0;
                    self.settings.surfaceColor = [r, g, b];
                });
            }

            // Distance-based shading controls
            const depthFalloffSelect = document.getElementById('depthFalloffSelect');
            const depthMaxDistRow = document.getElementById('depthMaxDistRow');
            const depthExpDecayRow = document.getElementById('depthExpDecayRow');
            if (depthFalloffSelect) {
                depthFalloffSelect.addEventListener('change', function() {
                    const mode = parseInt(this.value);
                    self.settings.depthFalloffType = mode;
                    if (depthMaxDistRow) depthMaxDistRow.style.display = (mode === 0) ? 'flex' : 'none';
                    if (depthExpDecayRow) depthExpDecayRow.style.display = (mode === 1) ? 'flex' : 'none';
                });
            }

            this._bindSlider('depthMaxDistSlider', 'depthMaxDistValue',
                (v) => { self.settings.depthMaxDistance = parseFloat(v); },
                (v) => parseFloat(v).toFixed(0)
            );

            this._bindSlider('depthExpDecaySlider', 'depthExpDecayValue',
                (v) => { self.settings.depthExpDecay = parseFloat(v); },
                (v) => parseFloat(v).toFixed(3)
            );

            const depthInvertCheck = document.getElementById('depthInvertCheck');
            if (depthInvertCheck) {
                depthInvertCheck.addEventListener('change', function() {
                    self.settings.depthInvert = this.checked;
                });
            }

            const depthVoidSelect = document.getElementById('depthVoidSelect');
            if (depthVoidSelect) {
                depthVoidSelect.addEventListener('change', function() {
                    self.settings.depthVoidMode = parseInt(this.value);
                });
            }

            const depthLightingCheck = document.getElementById('depthLightingCheck');
            if (depthLightingCheck) {
                depthLightingCheck.addEventListener('change', function() {
                    self.settings.depthLighting = this.checked;
                });
            }
        }

        _bindSlider(sliderId, valueId, onChange, format) {
            const slider = document.getElementById(sliderId);
            const valueDisplay = document.getElementById(valueId);
            
            if (!slider || !valueDisplay) return;
            
            valueDisplay.textContent = format(slider.value);
            
            slider.addEventListener('input', function() {
                valueDisplay.textContent = format(this.value);
                onChange(this.value);
            });
        }
    }

    // Initialize when DOM is ready
    window.addEventListener('DOMContentLoaded', () => {
        app = new App();
        app.init();
    });
})();
