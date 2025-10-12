varying vec3 vColor;
varying vec2 vUv;
uniform sampler2D paneMap;
uniform float useTexture;

void main() {
    vec4 textureColor = vec4(1.0);
    if (useTexture > 0.5) {
        textureColor = texture2D(paneMap, vUv);
        if (textureColor.a < 0.05) discard;
    }

    vec3 baseColor = useTexture > 0.5 ? textureColor.rgb : vec3(1.0);
    vec3 finalColor = baseColor * vColor;
    float finalAlpha = useTexture > 0.5 ? textureColor.a : 1.0;
    gl_FragColor = vec4(finalColor, finalAlpha);
}
