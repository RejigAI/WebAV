import { TImgSource } from './chromakey';

interface IColorCorrectionOpts {
    masterPolynomial: number[];
    redPolynomial: number[];
    greenPolynomial: number[];
    bluePolynomial: number[];
}

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;
  void main() {
    gl_Position = vec4(a_position, 0, 1);
    v_texCoord = a_texCoord;
  }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform sampler2D u_image;
  uniform sampler2D u_masterLUT;
  uniform sampler2D u_redLUT;
  uniform sampler2D u_greenLUT;
  uniform sampler2D u_blueLUT;
  varying vec2 v_texCoord;

  vec3 applyColorCorrection(vec3 color) {
    vec3 afterMaster;
    afterMaster.r = texture2D(u_masterLUT, vec2(color.r, 0.5)).r;
    afterMaster.g = texture2D(u_masterLUT, vec2(color.g, 0.5)).r;
    afterMaster.b = texture2D(u_masterLUT, vec2(color.b, 0.5)).r;

    color.r = texture2D(u_redLUT, vec2(afterMaster.r, 0.5)).r;
    color.g = texture2D(u_greenLUT, vec2(afterMaster.g, 0.5)).r;
    color.b = texture2D(u_blueLUT, vec2(afterMaster.b, 0.5)).r;

    return color;
  }

  void main() {
    vec4 color = texture2D(u_image, v_texCoord);
    color.rgb = applyColorCorrection(color.rgb);
    gl_FragColor = color;
  }
`;

function createProgram(gl: WebGLRenderingContext, vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram {
  const vertexShader = gl.createShader(gl.VERTEX_SHADER);
  if (!vertexShader) throw new Error('Failed to create vertex shader');
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);

  const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  if (!fragmentShader) throw new Error('Failed to create fragment shader');
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);

  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create WebGL program');
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  return program;
}

function createTexture(gl: WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Failed to create WebGL texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

function createLUTTexture(gl: WebGLRenderingContext, lutData: number[]): WebGLTexture {
  const texture = createTexture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(lutData));
  return texture;
}

export const createColorCorrection = (opts: IColorCorrectionOpts) => {
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let imageTexture: WebGLTexture | null = null;
  let applyCorrection: ((source: TexImageSource) => void) | null = null;

  const initWebGL = (width: number, height: number) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    gl = canvas.getContext('webgl');
    if (!gl) throw new Error('WebGL not supported');

    program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    gl.useProgram(program);

    // Set up geometry
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, 1, 1,
    ]), gl.STATIC_DRAW);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 1, 1, 1, 0, 0, 1, 0,
    ]), gl.STATIC_DRAW);

    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Set up textures
    imageTexture = createTexture(gl);
    const masterLUTTexture = createLUTTexture(gl, opts.masterPolynomial);
    const redLUTTexture = createLUTTexture(gl, opts.redPolynomial);
    const greenLUTTexture = createLUTTexture(gl, opts.greenPolynomial);
    const blueLUTTexture = createLUTTexture(gl, opts.bluePolynomial);

    gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_masterLUT'), 1);
    gl.uniform1i(gl.getUniformLocation(program, 'u_redLUT'), 2);
    gl.uniform1i(gl.getUniformLocation(program, 'u_greenLUT'), 3);
    gl.uniform1i(gl.getUniformLocation(program, 'u_blueLUT'), 4);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, masterLUTTexture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, redLUTTexture);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, greenLUTTexture);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, blueLUTTexture);

    gl.viewport(0, 0, width, height);

    applyCorrection = (source: TexImageSource) => {
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, imageTexture!);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, source);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    };
  };

  return async (imgSource: TImgSource): Promise<ImageBitmap | VideoFrame> => {
    if (imgSource instanceof ImageBitmap) {
      if (!gl) initWebGL(imgSource.width, imgSource.height);
      applyCorrection!(imgSource);
      return createImageBitmap(gl!.canvas);
    } else if ('format' in imgSource) {  // VideoFrame
      if (!gl) initWebGL(imgSource.displayWidth, imgSource.displayHeight);
      applyCorrection!(imgSource);
      return new VideoFrame(gl!.canvas, { timestamp: imgSource.timestamp });
    } else {
      throw new Error('Unsupported image source type');
    }
  };
};
