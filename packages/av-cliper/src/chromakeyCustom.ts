import { TImgSource } from './chromakey'; // Assuming you have a types file

const vertexShader = `#version 300 es
  layout (location = 0) in vec4 a_position;
  layout (location = 1) in vec2 a_texCoord;
  out vec2 v_texCoord;
  void main () {
    gl_Position = a_position;
    v_texCoord = a_texCoord;
  }
`;

const fragmentShader = `#version 300 es
  precision highp float;
  out vec4 FragColor;
  in vec2 v_texCoord;

  uniform sampler2D frameTexture;
  uniform sampler2D masterLUT;
  uniform sampler2D redLUT;
  uniform sampler2D greenLUT;
  uniform sampler2D blueLUT;

  void main() {
    vec4 color = texture(frameTexture, v_texCoord);

    float m_r = texture(masterLUT, vec2(color.r, 0.5)).r;
    float m_g = texture(masterLUT, vec2(color.g, 0.5)).r;
    float m_b = texture(masterLUT, vec2(color.b, 0.5)).r;

    float r = texture(redLUT, vec2(m_r, 0.5)).r;
    float g = texture(greenLUT, vec2(m_g, 0.5)).r;
    float b = texture(blueLUT, vec2(m_b, 0.5)).r;

    FragColor = vec4(r, g, b, color.a);
  }
`;

const POINT_POS = [-1, 1, -1, -1, 1, -1, 1, -1, 1, 1, -1, 1];
const TEX_COORD_POS = [0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1];

function initShaderProgram(
  gl: WebGLRenderingContext,
  vsSource: string,
  fsSource: string,
) {
  const vertexShader = loadShader(gl, gl.VERTEX_SHADER, vsSource)!;
  const fragmentShader = loadShader(gl, gl.FRAGMENT_SHADER, fsSource)!;

  const shaderProgram = gl.createProgram()!;
  gl.attachShader(shaderProgram, vertexShader);
  gl.attachShader(shaderProgram, fragmentShader);
  gl.linkProgram(shaderProgram);

  if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    throw Error(
      gl.getProgramInfoLog(shaderProgram) ??
        'Unable to initialize the shader program',
    );
  }

  return shaderProgram;
}

function loadShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const errMsg = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw Error(errMsg ?? 'An error occurred compiling the shaders');
  }

  return shader;
}

function updateTexture(
  gl: WebGLRenderingContext,
  img: TImgSource,
  texture: WebGLTexture,
) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function initTexture(gl: WebGLRenderingContext) {
  const texture = gl.createTexture();
  if (texture == null) throw Error('Create WebGL texture error');
  gl.bindTexture(gl.TEXTURE_2D, texture);

  const level = 0;
  const internalFormat = gl.RGBA;
  const width = 1;
  const height = 1;
  const border = 0;
  const srcFormat = gl.RGBA;
  const srcType = gl.UNSIGNED_BYTE;
  const pixel = new Uint8Array([0, 0, 255, 255]);
  gl.texImage2D(
    gl.TEXTURE_2D,
    level,
    internalFormat,
    width,
    height,
    border,
    srcFormat,
    srcType,
    pixel,
  );

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return texture;
}

function createLUTTexture(gl: WebGLRenderingContext, data: number[]) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 256, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(data));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

interface IColorCorrectionOpts {
  masterPolynomial: number[];
  redPolynomial: number[];
  greenPolynomial: number[];
  bluePolynomial: number[];
}

function initCvs(
  opts: {
    width: number;
    height: number;
  } & IColorCorrectionOpts,
) {
  const cvs =
    'document' in globalThis
      ? globalThis.document.createElement('canvas')
      : new OffscreenCanvas(opts.width, opts.height);
  cvs.width = opts.width;
  cvs.height = opts.height;

  const gl = cvs.getContext('webgl2', {
    premultipliedAlpha: false,
    alpha: true,
  }) as WebGL2RenderingContext | null;

  if (gl == null) throw Error('Cant create gl context');

  const shaderProgram = initShaderProgram(gl, vertexShader, fragmentShader);
  gl.useProgram(shaderProgram);

  const masterLUTTexture = createLUTTexture(gl, opts.masterPolynomial);
  const redLUTTexture = createLUTTexture(gl, opts.redPolynomial);
  const greenLUTTexture = createLUTTexture(gl, opts.greenPolynomial);
  const blueLUTTexture = createLUTTexture(gl, opts.bluePolynomial);

  gl.uniform1i(gl.getUniformLocation(shaderProgram, 'frameTexture'), 0);
  gl.uniform1i(gl.getUniformLocation(shaderProgram, 'masterLUT'), 1);
  gl.uniform1i(gl.getUniformLocation(shaderProgram, 'redLUT'), 2);
  gl.uniform1i(gl.getUniformLocation(shaderProgram, 'greenLUT'), 3);
  gl.uniform1i(gl.getUniformLocation(shaderProgram, 'blueLUT'), 4);

  const posBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(POINT_POS), gl.STATIC_DRAW);
  const a_position = gl.getAttribLocation(shaderProgram, 'a_position');
  gl.vertexAttribPointer(
    a_position,
    2,
    gl.FLOAT,
    false,
    Float32Array.BYTES_PER_ELEMENT * 2,
    0,
  );
  gl.enableVertexAttribArray(a_position);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(TEX_COORD_POS),
    gl.STATIC_DRAW,
  );
  const a_texCoord = gl.getAttribLocation(shaderProgram, 'a_texCoord');
  gl.vertexAttribPointer(
    a_texCoord,
    2,
    gl.FLOAT,
    false,
    Float32Array.BYTES_PER_ELEMENT * 2,
    0,
  );
  gl.enableVertexAttribArray(a_texCoord);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);

  return { cvs, gl, masterLUTTexture, redLUTTexture, greenLUTTexture, blueLUTTexture };
}

function getSourceWH(imgSource: TImgSource) {
  return imgSource instanceof VideoFrame
    ? { width: imgSource.codedWidth, height: imgSource.codedHeight }
    : { width: imgSource.width, height: imgSource.height };
}

export const createColorCorrection = (
  opts: IColorCorrectionOpts,
) => {
  let cvs: HTMLCanvasElement | OffscreenCanvas | null = null;
  let gl: WebGLRenderingContext | null = null;
  let texture: WebGLTexture | null = null;
  let masterLUTTexture: WebGLTexture | null = null;
  let redLUTTexture: WebGLTexture | null = null;
  let greenLUTTexture: WebGLTexture | null = null;
  let blueLUTTexture: WebGLTexture | null = null;

  return async (imgSource: TImgSource) => {
    if (cvs == null || gl == null || texture == null) {
      ({ cvs, gl, masterLUTTexture, redLUTTexture, greenLUTTexture, blueLUTTexture } = initCvs({
        ...getSourceWH(imgSource),
        ...opts,
      }));
      texture = initTexture(gl);
    }

    gl.activeTexture(gl.TEXTURE0);
    updateTexture(gl, imgSource, texture);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, masterLUTTexture!);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, redLUTTexture!);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, greenLUTTexture!);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, blueLUTTexture!);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (
      globalThis.VideoFrame != null &&
      imgSource instanceof globalThis.VideoFrame
    ) {
      const rs = new VideoFrame(cvs, {
        alpha: 'keep',
        timestamp: imgSource.timestamp,
        duration: imgSource.duration ?? undefined,
      });
      imgSource.close();
      return rs;
    }

    return createImageBitmap(cvs, {
      imageOrientation: imgSource instanceof ImageBitmap ? 'flipY' : 'none',
    });
  };
};
