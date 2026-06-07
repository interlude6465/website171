precision highp float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_globalTime;
uniform float u_pitch;
uniform float u_roll;

uniform sampler2D u_Texture;
varying vec2 v_TexCoord;

// From Stackoveflow
// http://stackoverflow.com/questions/15095909/from-rgb-to-hsv-in-opengl-glsl
vec3 hsv2rgb(vec3 c)
{
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Simplex 2D noise
// from https://gist.github.com/patriciogonzalezvivo/670c22f3966e662d2f83
vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
                      + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                            dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main(void){

    // This is old hologram effect, commented out so if we want to revert back in the future we can
    // vec2 uv = gl_FragCoord.xy / u_resolution;
    // float xnoise = snoise(vec2((uv.x, u_roll / 15.0) + 0.001 ));
    // float ynoise = snoise(vec2((uv.y, u_pitch / 15.0) + 0.001 ));

    // vec2 t = vec2(xnoise, ynoise);
    // float s1 = snoise(uv + t / 2.0 + snoise(uv + snoise(uv + t/3.0)));
    // vec3 hsv = vec3(s1, 0.2, 1.0);
    // vec3 rgb = hsv2rgb(hsv);

    vec4 textureVec = texture2D(u_Texture, v_TexCoord);

    // vec3 textureRGB = textureVec.rgb * textureVec.a;

    // The components (r, g, b, a) represent the red, green, blue and alpha color channels, respectively.

    // The roll of the device goes from -60 to 60.
    // The range at which a user will tilt their phone to show the hologram is -10 to 10
    // Transform the roll to be in a range of 0.0-1.0 based on a user's tilt range of -10 and 10, with the minimum alpha at 0.2
    float roll = (abs(u_roll) / 10.0) + 0.2;

    // The textureVec rgb values work together with the textureVec alpha value to create either a white or a transparent pixel
    // While the coat of arms image is mostly white with an alpha of 1.0 or clear with an alpha of 0.0, in the case of edge pixels there may be a pixel with an alpha in between 0 and 1.
    // Because of this, we must use the rgb and alpha of the textureVec to create the animation instead of simply discarding clear pixels
    // The outputted pixel should be a combination of the textureVec pixel and the roll value
    // A higher roll (aka phone more tilted) will create a more opaque pixel, while a lower roll (aka phone straight) will create a more transparent pixel
    float r = textureVec.r * roll;
    float g = textureVec.g * roll;
    float b = textureVec.b * roll;
    float alpha = textureVec.a * roll;

    gl_FragColor = vec4(r, g, b, alpha);
}