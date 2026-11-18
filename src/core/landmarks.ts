// Index sets into MediaPipe's 478-point face mesh. Every landmark index used by the app lives here.

/** Eye corners, nose tip and mouth corners: stable points for fitting frame-to-frame transforms from faces. */
export const ALIGN_POINTS = [33, 133, 362, 263, 1, 61, 291];

/** Eye corners, nose bridge and upper face oval: points that stay rigid across expressions (swap feasibility, placement). */
export const RIGID_POINTS = [33, 133, 362, 263, 6, 168, 10, 338, 297, 332, 284, 251, 21, 54, 103, 67, 109, 162, 389];

/** Outer and inner corners of each eye (the subject's right eye is on the image's left). */
export const EYE_CORNERS = {
  right: { outer: 33, inner: 133 },
  left: { outer: 263, inner: 362 },
};

export const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export const BROWS = [70, 63, 105, 66, 107, 336, 296, 334, 293, 300];

/** Per eye: its contour, its eyebrow, and the lower lid (pushed down into the cheek for eye-swap masks). */
export const EYE_REGIONS = [
  {
    contour: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
    brow: [70, 63, 105, 66, 107, 55, 65, 52, 53, 46],
    lowerLid: [33, 7, 163, 144, 145, 153, 154, 155, 133],
  },
  {
    contour: [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
    brow: [300, 293, 334, 296, 336, 285, 295, 282, 283, 276],
    lowerLid: [263, 249, 390, 373, 374, 380, 381, 382, 362],
  },
];

export const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
