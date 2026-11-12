/**
 * ImplicitRenderer - WebGL2 Ray Marching Renderer for 3D Implicit Equations
 *
 * Evaluates f(x, y, z) = 0 via ray marching with bisection root refinement,
 * central-difference surface normals, headlight Blinn-Phong shading, distance fog,
 * and coordinate axes rendering.
 */

(function (global) {
  'use strict';

  const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

  const DEFAULT_SETTINGS = {
    resolution: 0.5,        // Resolution scale (0.25 to 2.0)
    lightBrightness: 1.0,   // Light intensity from camera
    maxDistance: 50.0,      // Max ray distance
    stepSize: 0.05,         // Ray march step size
    bisectionSteps: 16,     // Bisection refinement iterations
    ambientLight: 0.15,     // Ambient light level
    fogDensity: 0.02,       // Distance fog density
    showAxes: true,         // Show coordinate axes
    surfaceColorMode: 0,    // 0=normal-based, 1=position-based, 2=solid
    surfaceColor: [0.8, 0.8, 0.8], // Solid surface color (when mode=2)
    specularStrength: 0.5,  // Specular highlight strength
    epsilon: 0.001,         // Normal computation epsilon
    maxSteps: 1000,         // Maximum ray march steps
    fov: 70.0,              // Field of view in degrees
    depthFalloffType: 0,    // 0=linear, 1=exponential
    depthMaxDistance: 30.0, // distance where linear hits complete black (fog)
    depthExpDecay: 0.05,    // exponential decay rate
    depthInvert: false,     // invert black and white
    depthVoidMode: 0,       // 0=black, 1=white, 2=skybox
    depthLighting: false    // modulate with surface lighting
  };

  class ImplicitRenderer {
    /**
     * Creates an ImplicitRenderer instance.
     * @param {HTMLCanvasElement} canvas The canvas element to render into.
     */
    constructor(canvas) {
      if (!canvas || typeof canvas.getContext !== 'function') {
        throw new Error('ImplicitRenderer requires a valid HTMLCanvasElement.');
      }

      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        alpha: false,
        stencil: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance'
      });

      if (!this.gl) {
        throw new Error('WebGL2 is not supported or context could not be initialized.');
      }

      const gl = this.gl;

      // Internal logical size (before resolution scaling)
      this.width = canvas.clientWidth || canvas.width || 800;
      this.height = canvas.clientHeight || canvas.height || 600;

      this.defaultSettings = Object.assign({}, DEFAULT_SETTINGS);
      this.currentProgram = null;
      this.currentFragmentShader = null;
      this.currentExpression = '';
      this.uniforms = {};
      this.lastCompilationResult = { success: false, error: null };

      // Compile fullscreen quad vertex shader
      this.vertexShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(this.vertexShader, VERTEX_SHADER_SOURCE);
      gl.compileShader(this.vertexShader);
      if (!gl.getShaderParameter(this.vertexShader, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(this.vertexShader);
        gl.deleteShader(this.vertexShader);
        throw new Error('Failed to compile vertex shader: ' + error);
      }

      // Fullscreen quad geometry (two triangles covering clip space [-1, 1])
      this.quadVAO = gl.createVertexArray();
      gl.bindVertexArray(this.quadVAO);

      this.quadVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
      const quadVertices = new Float32Array([
        -1.0, -1.0,
         1.0, -1.0,
        -1.0,  1.0,
        -1.0,  1.0,
         1.0, -1.0,
         1.0,  1.0
      ]);
      gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // Disable depth test and blending; ray marching handles full-screen color output
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);

      // Initialize with unit sphere: pow(x, 2.0) + pow(y, 2.0) + pow(z, 2.0) - 1.0
      const initialExpr = 'pow(x, 2.0) + pow(y, 2.0) + pow(z, 2.0) - 1.0';
      const initResult = this.updateEquation(initialExpr);
      if (!initResult.success) {
        console.error('Initial equation shader compilation error:', initResult.error);
      }
    }

    /**
     * Builds the fragment shader source code with the implicit equation injected.
     * @param {string} glslExpression 
     * @param {string} glslHelpers
     * @returns {string} Fragment shader source
     * @private
     */
    _buildFragmentShaderSource(glslExpression, glslHelpers = '') {
      return `#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_fovFactor;
uniform vec3 u_cameraPos;
uniform mat3 u_cameraRot;

uniform float u_lightBrightness;
uniform float u_maxDistance;
uniform float u_stepSize;
uniform int u_bisectionSteps;
uniform float u_ambientLight;
uniform float u_fogDensity;
uniform int u_showAxes;
uniform int u_surfaceColorMode;
uniform vec3 u_surfaceColor;
uniform float u_specularStrength;
uniform float u_epsilon;
uniform int u_maxSteps;

// Distance-based shading uniforms
uniform int u_depthFalloffType;
uniform float u_depthMaxDist;
uniform float u_depthExpDecay;
uniform int u_depthInvert;
uniform int u_depthVoidMode;
uniform int u_depthLighting;

// Common mathematical constants
const float PI = 3.14159265358979323846;
const float pi = 3.14159265358979323846;
const float E = 2.71828182845904523536;
const float e = 2.71828182845904523536;

// GCD with Desmos semantics: floor inputs
float gcdFunc(float a, float b) {
    a = abs(floor(a));
    b = abs(floor(b));
    if (a < 0.5 && b < 0.5) return 0.0;
    for (int i = 0; i < 64; i++) {
        if (b < 0.5) return a;
        float t = b;
        b = mod(a, b);
        a = t;
    }
    return a;
}

// LCM
float lcmFunc(float a, float b) {
    float g = gcdFunc(a, b);
    if (g < 0.5) return 0.0;
    return abs(floor(a) * floor(b)) / g;
}

// Mod with Desmos semantics
float modFunc(float a, float b) {
    return mod(a, b);
}

// sec, csc, cot
float sec(float x) { return 1.0 / cos(x); }
float csc(float x) { return 1.0 / sin(x); }
float cot(float x) { return cos(x) / sin(x); }

// Hyperbolic functions
float sinhFunc(float x) { return (exp(x) - exp(-x)) * 0.5; }
float coshFunc(float x) { return (exp(x) + exp(-x)) * 0.5; }
float tanhFunc(float x) { return sinhFunc(x) / coshFunc(x); }

// Safe math functions (Desmos semantics: undefined returns NaN)
float safeLog(float x) {
    if (x <= 0.0) return 0.0 / 0.0;
    return log(x);
}

float safeSqrt(float x) {
    if (x < 0.0) return 0.0 / 0.0;
    return sqrt(x);
}

float safeAsin(float x) {
    if (abs(x) > 1.0) return 0.0 / 0.0;
    return asin(x);
}

float safeAcos(float x) {
    if (abs(x) > 1.0) return 0.0 / 0.0;
    return acos(x);
}

// Trigonometric and log aliases
float ln(float x) { return safeLog(x); }
float log10(float x) { return safeLog(x) * 0.4342944819032518; }
float arcsin(float x) { return safeAsin(x); }
float arccos(float x) { return safeAcos(x); }
float arctan(float x) { return atan(x); }
float sgn(float x) { return sign(x); }

// Safe power function supporting negative bases with integer powers
float safePow(float a, float b) {
    if (a == 0.0) {
        if (b == 0.0) return 1.0;
        if (b < 0.0) return 0.0 / 0.0;
        return 0.0;
    }
    if (a < 0.0) {
        float r = floor(b + 0.5);
        if (abs(b - r) < 0.00001) {
            float p = pow(-a, b);
            return (mod(abs(r), 2.0) < 0.5) ? p : -p;
        }
        return 0.0 / 0.0; // NaN for non-integer exponent with negative base
    }
    return pow(a, b);
}

#define log(x) safeLog(x)
#define sqrt(x) safeSqrt(x)
#define asin(x) safeAsin(x)
#define acos(x) safeAcos(x)
#define pow(a, b) safePow(a, b)
#define gcd(a, b) gcdFunc(a, b)
#define lcm(a, b) lcmFunc(a, b)
#define sinh(x) sinhFunc(x)
#define cosh(x) coshFunc(x)
#define tanh(x) tanhFunc(x)

bool isInvalid(float v) {
    return isnan(v) || isinf(v) || (v != v);
}

${glslHelpers}

// Evaluates the implicit surface equation f(x, y, z)
float evaluateImplicit(vec3 p) {
    float x = p.x;
    float y = p.y;
    float z = p.z;
    return ${glslExpression};
}

// Robust surface normal computation via central/forward/backward differences
vec3 computeNormal(vec3 p, float eps) {
    float v0 = evaluateImplicit(p);
    vec3 e1 = vec3(eps, 0.0, 0.0);
    vec3 e2 = vec3(0.0, eps, 0.0);
    vec3 e3 = vec3(0.0, 0.0, eps);
    
    float v1p = evaluateImplicit(p + e1);
    float v1m = evaluateImplicit(p - e1);
    float dx = (!isInvalid(v1p) && !isInvalid(v1m)) ? (v1p - v1m) :
               (!isInvalid(v1p) ? 2.0 * (v1p - v0) :
               (!isInvalid(v1m) ? 2.0 * (v0 - v1m) : 0.0));
               
    float v2p = evaluateImplicit(p + e2);
    float v2m = evaluateImplicit(p - e2);
    float dy = (!isInvalid(v2p) && !isInvalid(v2m)) ? (v2p - v2m) :
               (!isInvalid(v2p) ? 2.0 * (v2p - v0) :
               (!isInvalid(v2m) ? 2.0 * (v0 - v2m) : 0.0));
               
    float v3p = evaluateImplicit(p + e3);
    float v3m = evaluateImplicit(p - e3);
    float dz = (!isInvalid(v3p) && !isInvalid(v3m)) ? (v3p - v3m) :
               (!isInvalid(v3p) ? 2.0 * (v3p - v0) :
               (!isInvalid(v3m) ? 2.0 * (v0 - v3m) : 0.0));
    
    vec3 n = vec3(dx, dy, dz);
    float len = length(n);
    if (len < 1e-6 || isInvalid(len)) {
        return vec3(0.0, 1.0, 0.0);
    }
    return n / len;
}

// Skybox gradient
vec3 skybox(vec3 rd) {
    float t = rd.y * 0.5 + 0.5;
    vec3 bottomColor = vec3(0.1, 0.1, 0.15);
    vec3 topColor = vec3(0.4, 0.6, 0.9);
    return mix(bottomColor, topColor, t);
}

void main() {
    // Ray generation with dynamic FOV
    vec2 uv = (gl_FragCoord.xy * u_pixelRatio - 0.5 * u_resolution) / u_resolution.y;
    vec3 rd = normalize(u_cameraRot * vec3(uv, u_fovFactor));
    vec3 ro = u_cameraPos;

    vec4 axisAccum = vec4(0.0);
    
    float t = 0.0;
    float prevT = 0.0;
    float prevVal = 0.0;
    bool hasPrev = false;
    
    bool hit = false;
    vec3 hitPos = vec3(0.0);
    vec3 hitNormal = vec3(0.0);
    float hitDistance = 0.0;

    for (int i = 0; i < 2048; i++) {
        if (i >= u_maxSteps) break;
        if (t > u_maxDistance) break;

        vec3 p = ro + t * rd;

        // Render coordinate axes when enabled
        if (u_showAxes == 1 && axisAccum.a < 0.8 && t > 0.05) {
            float dX = length(p.yz);
            float dY = length(p.xz);
            float dZ = length(p.xy);
            
            // Check closest segment distance along step to eliminate stepping gaps
            vec2 step_yz = rd.yz * u_stepSize;
            float t_x = clamp(-dot(p.yz, step_yz) / max(dot(step_yz, step_yz), 1e-8), 0.0, 1.0);
            dX = min(dX, length(p.yz + step_yz * t_x));
            
            vec2 step_xz = rd.xz * u_stepSize;
            float t_y = clamp(-dot(p.xz, step_xz) / max(dot(step_xz, step_xz), 1e-8), 0.0, 1.0);
            dY = min(dY, length(p.xz + step_xz * t_y));
            
            vec2 step_xy = rd.xy * u_stepSize;
            float t_z = clamp(-dot(p.xy, step_xy) / max(dot(step_xy, step_xy), 1e-8), 0.0, 1.0);
            dZ = min(dZ, length(p.xy + step_xy * t_z));

            float minDist = min(dX, min(dY, dZ));
            if (minDist < 0.02) {
                vec3 axCol = vec3(1.0, 0.2, 0.2); // X: Red
                if (dY <= dX && dY <= dZ) {
                    axCol = vec3(0.2, 0.9, 0.2); // Y: Green
                } else if (dZ <= dX && dZ <= dY) {
                    axCol = vec3(0.2, 0.45, 1.0); // Z: Blue
                }
                float alpha = clamp((1.0 - minDist / 0.02) * 0.5, 0.0, 0.5);
                axisAccum.rgb += (1.0 - axisAccum.a) * alpha * axCol;
                axisAccum.a += (1.0 - axisAccum.a) * alpha;
            }
        }

        float v = evaluateImplicit(p);

        if (isInvalid(v)) {
            hasPrev = false;
        } else {
            if (hasPrev) {
                if ((prevVal > 0.0 && v <= 0.0) || (prevVal < 0.0 && v >= 0.0)) {
                    // Sign change detected: refine with bisection
                    float tA = prevT;
                    float tB = t;
                    float vA = prevVal;

                    for (int b = 0; b < 32; b++) {
                        if (b >= u_bisectionSteps) break;
                        float tMid = 0.5 * (tA + tB);
                        vec3 pMid = ro + tMid * rd;
                        float vMid = evaluateImplicit(pMid);
                        if (isInvalid(vMid)) break;

                        if ((vA > 0.0 && vMid <= 0.0) || (vA < 0.0 && vMid >= 0.0)) {
                            tB = tMid;
                        } else {
                            tA = tMid;
                            vA = vMid;
                        }
                    }

                    hitDistance = 0.5 * (tA + tB);
                    hitPos = ro + hitDistance * rd;
                    hitNormal = computeNormal(hitPos, u_epsilon);
                    hit = true;
                    break;
                }
            }
            prevT = t;
            prevVal = v;
            hasPrev = true;
        }

        t += u_stepSize;
    }

    if (hit) {
        // Orient normal toward viewer for two-sided visibility
        if (dot(hitNormal, -rd) < 0.0) {
            hitNormal = -hitNormal;
        }

        // Headlight Blinn-Phong lighting
        vec3 lightDir = -rd;
        vec3 viewDir = -rd;
        vec3 halfVec = normalize(lightDir + viewDir);

        float diff = max(dot(hitNormal, lightDir), 0.0) * u_lightBrightness;
        float spec = pow(max(dot(hitNormal, halfVec), 0.0), 32.0) * u_specularStrength;

        vec3 surfaceCol;
        if (u_surfaceColorMode == 3) {
            float val;
            if (u_depthFalloffType == 0) {
                // Linear falloff: pixels closer are whiter (1.0), pixels farther are blacker, reaching completely black at u_depthMaxDist
                val = clamp(1.0 - (hitDistance / max(u_depthMaxDist, 0.001)), 0.0, 1.0);
            } else {
                // Exponential falloff: exponentially decreases brightness, no pixels are completely black for finite distance
                val = clamp(exp(-u_depthExpDecay * hitDistance), 0.0, 1.0);
            }

            // Invert black and white colors if enabled
            if (u_depthInvert == 1) {
                val = 1.0 - val;
            }

            vec3 depthCol = vec3(val);
            if (u_depthLighting == 1) {
                depthCol *= (u_ambientLight + diff);
            }
            surfaceCol = depthCol;
        } else {
            vec3 baseColor;
            if (u_surfaceColorMode == 0) {
                baseColor = abs(hitNormal) * 0.5 + 0.5;
            } else if (u_surfaceColorMode == 1) {
                baseColor = fract(hitPos * 0.5) * 0.8 + 0.2;
            } else {
                baseColor = u_surfaceColor;
            }

            vec3 litColor = baseColor * (u_ambientLight + diff) + vec3(spec);

            // Distance fog
            vec3 sky = skybox(rd);
            float fogFactor = 1.0 - exp(-hitDistance * u_fogDensity);
            fogFactor = clamp(fogFactor, 0.0, 1.0);
            surfaceCol = mix(litColor, sky, fogFactor);
        }

        // Semi-transparent axes overlay
        if (u_showAxes == 1 && axisAccum.a > 0.0) {
            fragColor = vec4(axisAccum.rgb + (1.0 - axisAccum.a) * surfaceCol, 1.0);
        } else {
            fragColor = vec4(surfaceCol, 1.0);
        }
    } else {
        vec3 voidCol;
        if (u_surfaceColorMode == 3) {
            if (u_depthVoidMode == 0) {
                voidCol = vec3(0.0); // Completely black for void
            } else if (u_depthVoidMode == 1) {
                voidCol = vec3(1.0); // White
            } else {
                voidCol = skybox(rd); // Skybox
            }
        } else {
            voidCol = skybox(rd);
        }

        if (u_showAxes == 1 && axisAccum.a > 0.0) {
            fragColor = vec4(axisAccum.rgb + (1.0 - axisAccum.a) * voidCol, 1.0);
        } else {
            fragColor = vec4(voidCol, 1.0);
        }
    }
}
`;
    }

    /**
     * Updates the implicit equation and recompiles the fragment shader.
     * Keeps the previous program active if compilation fails.
     * @param {string} glslExpression GLSL expression representing f(x, y, z) = 0.
     * @param {string} glslHelpers Helper function definitions for the expression.
     * @returns {{success: boolean, error: string|null}}
     */
    updateEquation(glslExpression, glslHelpers = '') {
      let expr = (glslExpression || '').trim();
      if (!expr) {
        this.lastCompilationResult = { success: false, error: 'Empty equation expression.' };
        return this.lastCompilationResult;
      }

      // Strip any trailing semicolons
      expr = expr.replace(/;+$/, '').trim();

      // If user passed "lhs = rhs", convert to "(lhs) - (rhs)"
      if (expr.includes('=') && !expr.includes('==') && !expr.includes('<=') && !expr.includes('>=') && !expr.includes('!=')) {
        const parts = expr.split('=');
        if (parts.length === 2) {
          expr = `(${parts[0].trim()}) - (${parts[1].trim()})`;
        }
      }

      const gl = this.gl;
      const fsSource = this._buildFragmentShaderSource(expr, glslHelpers);

      const fs = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fs, fsSource);
      gl.compileShader(fs);

      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        const error = gl.getShaderInfoLog(fs) || 'Fragment shader compilation failed.';
        gl.deleteShader(fs);
        this.lastCompilationResult = { success: false, error: error };
        return this.lastCompilationResult;
      }

      const program = gl.createProgram();
      gl.attachShader(program, this.vertexShader);
      gl.attachShader(program, fs);
      gl.bindAttribLocation(program, 0, 'a_position');
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const error = gl.getProgramInfoLog(program) || 'Program linking failed.';
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        this.lastCompilationResult = { success: false, error: error };
        return this.lastCompilationResult;
      }

      // Compilation and linking succeeded: swap out old shader and program
      if (this.currentProgram) {
        gl.deleteProgram(this.currentProgram);
      }
      if (this.currentFragmentShader) {
        gl.deleteShader(this.currentFragmentShader);
      }

      this.currentProgram = program;
      this.currentFragmentShader = fs;
      this.currentExpression = expr;

      // Cache all uniform locations
      this.uniforms = {
        u_resolution: gl.getUniformLocation(program, 'u_resolution'),
        u_pixelRatio: gl.getUniformLocation(program, 'u_pixelRatio'),
        u_fovFactor: gl.getUniformLocation(program, 'u_fovFactor'),
        u_cameraPos: gl.getUniformLocation(program, 'u_cameraPos'),
        u_cameraRot: gl.getUniformLocation(program, 'u_cameraRot'),
        u_lightBrightness: gl.getUniformLocation(program, 'u_lightBrightness'),
        u_maxDistance: gl.getUniformLocation(program, 'u_maxDistance'),
        u_stepSize: gl.getUniformLocation(program, 'u_stepSize'),
        u_bisectionSteps: gl.getUniformLocation(program, 'u_bisectionSteps'),
        u_ambientLight: gl.getUniformLocation(program, 'u_ambientLight'),
        u_fogDensity: gl.getUniformLocation(program, 'u_fogDensity'),
        u_showAxes: gl.getUniformLocation(program, 'u_showAxes'),
        u_surfaceColorMode: gl.getUniformLocation(program, 'u_surfaceColorMode'),
        u_surfaceColor: gl.getUniformLocation(program, 'u_surfaceColor'),
        u_specularStrength: gl.getUniformLocation(program, 'u_specularStrength'),
        u_epsilon: gl.getUniformLocation(program, 'u_epsilon'),
        u_maxSteps: gl.getUniformLocation(program, 'u_maxSteps'),
        u_depthFalloffType: gl.getUniformLocation(program, 'u_depthFalloffType'),
        u_depthMaxDist: gl.getUniformLocation(program, 'u_depthMaxDist'),
        u_depthExpDecay: gl.getUniformLocation(program, 'u_depthExpDecay'),
        u_depthInvert: gl.getUniformLocation(program, 'u_depthInvert'),
        u_depthVoidMode: gl.getUniformLocation(program, 'u_depthVoidMode'),
        u_depthLighting: gl.getUniformLocation(program, 'u_depthLighting')
      };

      this.lastCompilationResult = { success: true, error: null };
      return this.lastCompilationResult;
    }

    /**
     * Resizes the canvas view dimension.
     * @param {number} width 
     * @param {number} height 
     */
    resize(width, height) {
      this.width = width || this.canvas.clientWidth || window.innerWidth || 800;
      this.height = height || this.canvas.clientHeight || window.innerHeight || 600;
    }

    /**
     * Renders a frame.
     * @param {Float32Array|Array<number>} cameraPos 3-element camera position [x, y, z]
     * @param {Float32Array|Array<number>} cameraRotMatrix 9-element 3x3 rotation matrix (column-major)
     * @param {object} [settings] Rendering settings override
     */
    render(cameraPos, cameraRotMatrix, settings) {
      if (!this.currentProgram) {
        return;
      }

      const gl = this.gl;
      const s = Object.assign({}, this.defaultSettings, settings);

      // Handle resolution scaling (internal buffer size = display size * settings.resolution)
      const res = (typeof s.resolution === 'number' && s.resolution > 0) ? s.resolution : 1.0;
      const dispWidth = this.width || this.canvas.clientWidth || 800;
      const dispHeight = this.height || this.canvas.clientHeight || 600;

      const targetWidth = Math.max(1, Math.round(dispWidth * res));
      const targetHeight = Math.max(1, Math.round(dispHeight * res));

      if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
        this.canvas.width = targetWidth;
        this.canvas.height = targetHeight;
      }

      gl.viewport(0, 0, targetWidth, targetHeight);

      gl.useProgram(this.currentProgram);
      gl.bindVertexArray(this.quadVAO);

      // Logical resolution & pixel ratio for ray direction FOV calculation
      if (this.uniforms.u_resolution) {
        gl.uniform2f(this.uniforms.u_resolution, dispWidth, dispHeight);
      }
      if (this.uniforms.u_pixelRatio) {
        gl.uniform1f(this.uniforms.u_pixelRatio, 1.0 / res);
      }
      if (this.uniforms.u_fovFactor) {
        const fovRad = ((s.fov !== undefined ? s.fov : 70.0) * Math.PI) / 180.0;
        const fovFactor = 0.5 / Math.tan(fovRad * 0.5);
        gl.uniform1f(this.uniforms.u_fovFactor, fovFactor);
      }

      // Camera uniforms
      const cPos = cameraPos || [0, 0, 5];
      if (this.uniforms.u_cameraPos) {
        gl.uniform3f(this.uniforms.u_cameraPos, cPos[0], cPos[1], cPos[2]);
      }

      const cRot = cameraRotMatrix || [1, 0, 0, 0, 1, 0, 0, 0, 1];
      if (this.uniforms.u_cameraRot) {
        gl.uniformMatrix3fv(this.uniforms.u_cameraRot, false, cRot);
      }

      // Render settings uniforms
      if (this.uniforms.u_lightBrightness) {
        gl.uniform1f(this.uniforms.u_lightBrightness, s.lightBrightness !== undefined ? s.lightBrightness : 1.0);
      }
      if (this.uniforms.u_maxDistance) {
        gl.uniform1f(this.uniforms.u_maxDistance, s.maxDistance !== undefined ? s.maxDistance : 50.0);
      }
      if (this.uniforms.u_stepSize) {
        gl.uniform1f(this.uniforms.u_stepSize, s.stepSize !== undefined ? s.stepSize : 0.05);
      }
      if (this.uniforms.u_bisectionSteps) {
        gl.uniform1i(this.uniforms.u_bisectionSteps, s.bisectionSteps !== undefined ? s.bisectionSteps : 16);
      }
      if (this.uniforms.u_ambientLight) {
        gl.uniform1f(this.uniforms.u_ambientLight, s.ambientLight !== undefined ? s.ambientLight : 0.15);
      }
      if (this.uniforms.u_fogDensity) {
        gl.uniform1f(this.uniforms.u_fogDensity, s.fogDensity !== undefined ? s.fogDensity : 0.02);
      }
      if (this.uniforms.u_showAxes) {
        gl.uniform1i(this.uniforms.u_showAxes, s.showAxes ? 1 : 0);
      }
      if (this.uniforms.u_surfaceColorMode) {
        gl.uniform1i(this.uniforms.u_surfaceColorMode, s.surfaceColorMode !== undefined ? s.surfaceColorMode : 0);
      }
      if (this.uniforms.u_surfaceColor) {
        const col = (Array.isArray(s.surfaceColor) && s.surfaceColor.length >= 3)
          ? s.surfaceColor
          : [0.8, 0.8, 0.8];
        gl.uniform3f(this.uniforms.u_surfaceColor, col[0], col[1], col[2]);
      }
      if (this.uniforms.u_specularStrength) {
        gl.uniform1f(this.uniforms.u_specularStrength, s.specularStrength !== undefined ? s.specularStrength : 0.5);
      }
      if (this.uniforms.u_epsilon) {
        gl.uniform1f(this.uniforms.u_epsilon, s.epsilon !== undefined ? s.epsilon : 0.001);
      }
      if (this.uniforms.u_maxSteps) {
        gl.uniform1i(this.uniforms.u_maxSteps, s.maxSteps !== undefined ? s.maxSteps : 1000);
      }
      if (this.uniforms.u_depthFalloffType) {
        gl.uniform1i(this.uniforms.u_depthFalloffType, s.depthFalloffType !== undefined ? s.depthFalloffType : 0);
      }
      if (this.uniforms.u_depthMaxDist) {
        gl.uniform1f(this.uniforms.u_depthMaxDist, s.depthMaxDistance !== undefined ? s.depthMaxDistance : 30.0);
      }
      if (this.uniforms.u_depthExpDecay) {
        gl.uniform1f(this.uniforms.u_depthExpDecay, s.depthExpDecay !== undefined ? s.depthExpDecay : 0.05);
      }
      if (this.uniforms.u_depthInvert) {
        gl.uniform1i(this.uniforms.u_depthInvert, s.depthInvert ? 1 : 0);
      }
      if (this.uniforms.u_depthVoidMode) {
        gl.uniform1i(this.uniforms.u_depthVoidMode, s.depthVoidMode !== undefined ? s.depthVoidMode : 0);
      }
      if (this.uniforms.u_depthLighting) {
        gl.uniform1i(this.uniforms.u_depthLighting, s.depthLighting ? 1 : 0);
      }

      // Draw full screen quad
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindVertexArray(null);
    }

    /**
     * Clean up all WebGL resources.
     */
    dispose() {
      const gl = this.gl;
      if (!gl) return;

      if (this.quadVAO) {
        gl.deleteVertexArray(this.quadVAO);
        this.quadVAO = null;
      }
      if (this.quadVBO) {
        gl.deleteBuffer(this.quadVBO);
        this.quadVBO = null;
      }
      if (this.vertexShader) {
        gl.deleteShader(this.vertexShader);
        this.vertexShader = null;
      }
      if (this.currentFragmentShader) {
        gl.deleteShader(this.currentFragmentShader);
        this.currentFragmentShader = null;
      }
      if (this.currentProgram) {
        gl.deleteProgram(this.currentProgram);
        this.currentProgram = null;
      }
    }
  }

  // Expose to window and module systems
  if (typeof window !== 'undefined') {
    window.ImplicitRenderer = ImplicitRenderer;
  }
  if (typeof global !== 'undefined') {
    global.ImplicitRenderer = ImplicitRenderer;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImplicitRenderer;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
