const { latexToGLSL } = require('./js/latex-parser.js');

const examples = [
  { name: 'Sphere', latex: 'x^2+y^2+z^2=1' },
  { name: 'Torus', latex: String.raw`\left(\sqrt{x^2+z^2}-2\right)^2+y^2=0.5` },
  { name: 'Gyroid', latex: String.raw`\sin(x)\cos(y)+\sin(y)\cos(z)+\sin(z)\cos(x)=0` },
  { name: 'Schwarz P', latex: String.raw`\cos(x)+\cos(y)+\cos(z)=0` },
  { name: 'Cylinder', latex: 'x^2+z^2=1' },
  { name: 'Cone', latex: 'x^2+z^2-y^2=0' },
  { name: 'Hyperboloid', latex: 'x^2-y^2+z^2=1' },
  { name: 'Sine Waves', latex: String.raw`\sin(x)+\sin(y)+\sin(z)=1` },
  { name: 'Complex GCD', latex: String.raw`\cos\left(y\right)2^{x\sin\left(x\right)}=\log_{2}\left(\gcd\left(z,x\right)\right)` },
  { name: 'Tangled Cube', latex: 'x^{4}-5x^{2}+y^{4}-5y^{2}+z^{4}-5z^{2}+11.8=0' },
  { name: 'Heart', latex: String.raw`\left(x^2+\frac{9}{4}y^2+z^2-1\right)^3-x^2z^3-\frac{9}{80}y^2z^3=0` },
  { name: 'Cassini', latex: String.raw`\left(x^2+y^2+z^2+0.45^2\right)^2-4\cdot0.45^2\left(x^2+z^2\right)=0.1` },
  { name: 'Lattice', latex: String.raw`\cos(x)\cos(y)\cos(z)=0.3` },
  { name: 'GCD Surface', latex: String.raw`\gcd(x,z)=y` },
  { name: 'Floor Stairs', latex: String.raw`y=\floor(x)+\floor(z)` },
];
