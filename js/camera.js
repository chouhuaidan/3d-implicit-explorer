// ============================================
// FPS Camera System
// ============================================
// Provides first-person fly camera with mouse look and WASD controls.

(function() {
    'use strict';

    class FPSCamera {
        constructor() {
            // Position - start at (0, 0, -5) looking toward origin
            this.position = new Float32Array([0, 0, -5]);
            
            // Euler angles (radians)
            this.yaw = 0;     // Rotation around Y axis (left-right)
            this.pitch = 0;    // Rotation around X axis (up-down)
            
            // Movement state
            this.keys = {};
            this.mouseSensitivity = 0.002;
            this.moveSpeed = 5.0;
            this.sprintMultiplier = 3.0;
            this.isPointerLocked = false;
            this.isDragging = false;
            this.invertY = false;
            
            // Rotation matrix (3x3, column-major for GLSL)
            this.rotationMatrix = new Float32Array(9);
            this._updateRotationMatrix();
            
            // Vectors for movement calculation
            this._forward = new Float32Array(3);
            this._right = new Float32Array(3);
            this._up = new Float32Array(3);
            this._hForward = new Float32Array(3);
            this._hRight = new Float32Array(3);
        }
        
        /**
         * Initialize event listeners on the canvas
         */
        init(canvas) {
            this.canvas = canvas;
            
            // Mouse look via Pointer Lock API or mouse drag
            canvas.addEventListener('click', () => {
                if (!this.isPointerLocked) {
                    canvas.requestPointerLock();
                }
            });
            
            canvas.addEventListener('mousedown', (e) => {
                if (e.button === 0) {
                    this.isDragging = true;
                }
            });
            
            window.addEventListener('mouseup', () => {
                this.isDragging = false;
            });
            
            document.addEventListener('pointerlockchange', () => {
                this.isPointerLocked = document.pointerLockElement === canvas;
            });
            
            document.addEventListener('mousemove', (e) => {
                if (!this.isPointerLocked && !this.isDragging) return;
                
                // Natural FPS mouse look: mouse right turns right, mouse up looks up
                this.yaw += e.movementX * this.mouseSensitivity;
                const sign = this.invertY ? -1 : 1;
                this.pitch -= e.movementY * this.mouseSensitivity * sign;
                
                // Clamp pitch to avoid gimbal lock (-89° to +89°)
                this.pitch = Math.max(-Math.PI * 0.495, Math.min(Math.PI * 0.495, this.pitch));
                
                this._updateRotationMatrix();
            });
            
            // Keyboard controls
            document.addEventListener('keydown', (e) => {
                this.keys[e.code] = true;
            });
            
            document.addEventListener('keyup', (e) => {
                this.keys[e.code] = false;
            });
            
            // Prevent context menu on right-click
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        
        /**
         * Update camera position based on keyboard input
         */
        update(deltaTime) {
            // Don't move if user is typing in a text field
            const activeTag = document.activeElement ? document.activeElement.tagName : '';
            if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT') {
                return;
            }
            
            let speed = this.moveSpeed * deltaTime;
            // Minecraft sprint (Ctrl)
            if (this.keys['ControlLeft'] || this.keys['ControlRight']) {
                speed *= this.sprintMultiplier;
            }
            
            // Calculate movement vectors from rotation
            this._calcMovementVectors();
            
            // Minecraft style: WASD moves strictly horizontally on the XZ plane
            // Forward / Backward (W / S)
            if (this.keys['KeyW']) {
                this.position[0] += this._hForward[0] * speed;
                this.position[2] += this._hForward[2] * speed;
            }
            if (this.keys['KeyS']) {
                this.position[0] -= this._hForward[0] * speed;
                this.position[2] -= this._hForward[2] * speed;
            }
            
            // Strafe Left / Right (A / D)
            if (this.keys['KeyA']) {
                this.position[0] -= this._hRight[0] * speed;
                this.position[2] -= this._hRight[2] * speed;
            }
            if (this.keys['KeyD']) {
                this.position[0] += this._hRight[0] * speed;
                this.position[2] += this._hRight[2] * speed;
            }
            
            // Vertical movement (Space = Fly Up, Shift / C = Fly Down)
            if (this.keys['Space']) {
                this.position[1] += speed;
            }
            if (this.keys['ShiftLeft'] || this.keys['ShiftRight'] || this.keys['KeyC']) {
                this.position[1] -= speed;
            }
        }
        
        /**
         * Calculate forward, right, up vectors from yaw/pitch
         */
        _calcMovementVectors() {
            const cy = Math.cos(this.yaw);
            const sy = Math.sin(this.yaw);
            const cp = Math.cos(this.pitch);
            const sp = Math.sin(this.pitch);
            
            // Forward vector (direction camera is looking)
            this._forward[0] = sy * cp;
            this._forward[1] = sp;
            this._forward[2] = cy * cp;
            
            // Right vector (perpendicular to forward and world up)
            this._right[0] = cy;
            this._right[1] = 0;
            this._right[2] = -sy;
            
            // Up vector
            this._up[0] = -sy * sp;
            this._up[1] = cp;
            this._up[2] = -cy * sp;

            // Minecraft horizontal vectors (pure XZ plane, ignoring pitch)
            this._hForward[0] = sy;
            this._hForward[1] = 0;
            this._hForward[2] = cy;

            this._hRight[0] = cy;
            this._hRight[1] = 0;
            this._hRight[2] = -sy;
        }
        
        /**
         * Update the 3x3 rotation matrix (column-major) from yaw/pitch
         * This matrix transforms from camera space to world space
         */
        _updateRotationMatrix() {
            const cy = Math.cos(this.yaw);
            const sy = Math.sin(this.yaw);
            const cp = Math.cos(this.pitch);
            const sp = Math.sin(this.pitch);
            
            // Column 0 (Camera Right in world space)
            this.rotationMatrix[0] = cy;
            this.rotationMatrix[1] = 0;
            this.rotationMatrix[2] = -sy;
            
            // Column 1 (Camera Up in world space)
            this.rotationMatrix[3] = -sy * sp;
            this.rotationMatrix[4] = cp;
            this.rotationMatrix[5] = -cy * sp;
            
            // Column 2 (Camera Forward in world space)
            this.rotationMatrix[6] = sy * cp;
            this.rotationMatrix[7] = sp;
            this.rotationMatrix[8] = cy * cp;
        }
        
        /**
         * Get the position array for passing to renderer
         */
        getPosition() {
            return this.position;
        }
        
        /**
         * Get the rotation matrix for passing to renderer
         */
        getRotationMatrix() {
            return this.rotationMatrix;
        }
        
        /**
         * Set camera position
         */
        setPosition(x, y, z) {
            this.position[0] = x;
            this.position[1] = y;
            this.position[2] = z;
        }
        
        /**
         * Reset camera to default position and orientation
         */
        reset() {
            this.setPosition(0, 0, -5);
            this.yaw = 0;
            this.pitch = 0;
            this._updateRotationMatrix();
        }
    }
    
    window.FPSCamera = FPSCamera;
})();
