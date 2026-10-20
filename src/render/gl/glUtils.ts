// Small WebGL2 helpers: programs, textures and render targets.

export class GLProgram {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly name: string,
  ) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${name}.vert`);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${name}.frag`);
    const program = gl.createProgram();
    if (!program) throw new Error(`Could not create program ${name}`);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program) ?? '';
      gl.deleteProgram(program);
      throw new Error(`Link failed for ${name}: ${log}`);
    }
    this.program = program;
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  loc(uniform: string): WebGLUniformLocation | null {
    let l = this.locations.get(uniform);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, uniform);
      this.locations.set(uniform, l);
    }
    return l;
  }

  set1i(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v);
  }
  set1f(name: string, v: number): void {
    this.gl.uniform1f(this.loc(name), v);
  }
  set2f(name: string, x: number, y: number): void {
    this.gl.uniform2f(this.loc(name), x, y);
  }
  set4fv(name: string, v: Float32Array): void {
    this.gl.uniform4fv(this.loc(name), v);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create shader ${label}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Compile failed for ${label}: ${log}`);
  }
  return shader;
}

/** A texture with an attached framebuffer. */
export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  width: number;
  height: number;
}

export type TargetFormat = 'rgba16f' | 'rgba8';

function setSampling(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** Creates an empty LINEAR / CLAMP texture (unit 0 is left bound to it). */
export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Could not create texture');
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  setSampling(gl);
  return tex;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  format: TargetFormat,
): Target {
  const tex = createTexture(gl);
  if (format === 'rgba16f') {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Could not create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined): void {
  if (!t) return;
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

/** Picks RGBA16F render targets when the device can render to them, else RGBA8. */
export function chooseTargetFormat(gl: WebGL2RenderingContext): TargetFormat {
  if (!gl.getExtension('EXT_color_buffer_float')) return 'rgba8';
  let probe: Target | null = null;
  try {
    probe = createTarget(gl, 4, 4, 'rgba16f');
    gl.bindFramebuffer(gl.FRAMEBUFFER, probe.fbo);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return ok ? 'rgba16f' : 'rgba8';
  } catch {
    return 'rgba8';
  } finally {
    deleteTarget(gl, probe);
  }
}

/** Intrinsic size of a TexImageSource, when it can be read. */
export function intrinsicSize(image: TexImageSource): { width: number; height: number } | null {
  const any = image as unknown as Record<string, unknown>;
  const pick = (w: unknown, h: unknown) =>
    typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0 ? { width: w, height: h } : null;
  if (typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) {
    return pick(image.naturalWidth, image.naturalHeight);
  }
  if (typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement) {
    return pick(image.videoWidth, image.videoHeight);
  }
  if ('displayWidth' in any) return pick(any.displayWidth, any.displayHeight); // VideoFrame
  return pick(any.width, any.height);
}

/** Draws any TexImageSource into a new 2D canvas of the given size (used to downscale). */
export function resampleToCanvas(image: TexImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (typeof ImageData !== 'undefined' && image instanceof ImageData) {
    const tmp = document.createElement('canvas');
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext('2d')?.putImageData(image, 0, 0);
    ctx.drawImage(tmp, 0, 0, width, height);
  } else {
    ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
  }
  return canvas;
}
