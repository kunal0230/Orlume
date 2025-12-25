/**
 * Geometry Math Engine
 * Handles 3x3 Homography Matrix construction and operations for Projective Transforms.
 */

export class GeometryMath {

    /**
     * Create a composite Homography Matrix from user parameters
     * Order: Offset -> Scale -> Aspect -> Rotate -> Perspective (Vertical/Horizontal)
     * All parameters are assumed normalized or in degrees as per UI
     */
    static createHomography(params) {
        const {
            vertical = 0,   // Perspective Vertical (-100 to 100)
            horizontal = 0, // Perspective Horizontal (-100 to 100)
            rotate = 0,     // Degrees
            aspect = 0,     // Aspect (-100 to 100)
            scale = 100,    // Scale (0 to 200, default 100)
            xOffset = 0,    // X Offset (-100 to 100)
            yOffset = 0     // Y Offset (-100 to 100)
        } = params;

        // 1. Perspective (Vertical / Horizontal)
        // v = vertical / 100
        const v = vertical / 100;
        const P_vert = [
            1, 0, 0,
            0, 1, v,
            0, v, 1
        ];

        const h = horizontal / 100;
        const P_horz = [
            1, 0, h,
            0, 1, 0,
            h, 0, 1
        ];

        const P = this.multiply(P_horz, P_vert);

        // 2. Rotate
        const rad = (rotate * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const R = [
            cos, -sin, 0,
            sin, cos, 0,
            0, 0, 1
        ];

        // 3. Aspect
        // Lightroom style: centered distortion
        const a = aspect / 200;
        const S_aspect = [
            1 + a, 0, 0,
            0, 1 - a, 0,
            0, 0, 1
        ];

        // 4. Scale
        const s = scale / 100;
        const S_scale = [
            s, 0, 0,
            0, s, 0,
            0, 0, 1
        ];

        // 5. Offset
        // Applied in normalized space
        const ox = xOffset / 100;
        const oy = yOffset / 100;
        const T_offset = [
            1, 0, ox,
            0, 1, oy,
            0, 0, 1
        ];

        // Composite: T * S_scale * S_aspect * R * P
        // Note: Multiplication order matters. 
        // We want perspective applied "first" to the geometry, then rotated, then scaled, then shifted?
        // Or reverse? 
        // Inverse Mapping: We go from Target Pixel -> Source Pixel.
        // So M goes Source -> Target.
        // M = T * S * R * P

        let M = P;
        M = this.multiply(R, M);
        M = this.multiply(S_aspect, M);
        M = this.multiply(S_scale, M);
        M = this.multiply(T_offset, M);

        return M;
    }

    /**
     * Multiply two 3x3 matrices (A * B)
     */
    static multiply(A, B) {
        const C = new Float32Array(9);

        // Row 0
        C[0] = A[0] * B[0] + A[1] * B[3] + A[2] * B[6];
        C[1] = A[0] * B[1] + A[1] * B[4] + A[2] * B[7];
        C[2] = A[0] * B[2] + A[1] * B[5] + A[2] * B[8];

        // Row 1
        C[3] = A[3] * B[0] + A[4] * B[3] + A[5] * B[6];
        C[4] = A[3] * B[1] + A[4] * B[4] + A[5] * B[7];
        C[5] = A[3] * B[2] + A[4] * B[5] + A[5] * B[8];

        // Row 2
        C[6] = A[6] * B[0] + A[7] * B[3] + A[8] * B[6];
        C[7] = A[6] * B[1] + A[7] * B[4] + A[8] * B[7];
        C[8] = A[6] * B[2] + A[7] * B[5] + A[8] * B[8];

        return C;
    }

    /**
     * Invert a 3x3 matrix
     */
    static invert(M) {
        const inv = new Float32Array(9);

        const m00 = M[0], m01 = M[1], m02 = M[2];
        const m10 = M[3], m11 = M[4], m12 = M[5];
        const m20 = M[6], m21 = M[7], m22 = M[8];

        const b01 = m22 * m11 - m12 * m21;
        const b11 = -m22 * m10 + m12 * m20;
        const b21 = m21 * m10 - m11 * m20;

        let det = m00 * b01 + m01 * b11 + m02 * b21;

        if (!det) return null; // Singular matrix
        det = 1.0 / det;

        inv[0] = b01 * det;
        inv[1] = (-m22 * m01 + m02 * m21) * det;
        inv[2] = (m12 * m01 - m02 * m11) * det;
        inv[3] = b11 * det;
        inv[4] = (m22 * m00 - m02 * m20) * det;
        inv[5] = (-m12 * m00 + m02 * m10) * det;
        inv[6] = b21 * det;
        inv[7] = (-m21 * m00 + m01 * m20) * det;
        inv[8] = (m11 * m00 - m01 * m10) * det;

        return inv;
    }
}
