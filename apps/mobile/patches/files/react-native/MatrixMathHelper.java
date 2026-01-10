/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

package com.facebook.react.uimanager;

import com.facebook.infer.annotation.Assertions;

/**
 * Provides helper methods for converting transform operations into a matrix and then into a list of
 * translate, scale and rotate commands.
 */
public class MatrixMathHelper {

  private static final double EPSILON = .00001d;

  public static class MatrixDecompositionContext {
    public double[] perspective = new double[4];
    public double[] scale = new double[3];
    public double[] skew = new double[3];
    public double[] translation = new double[3];
    public double[] rotationDegrees = new double[3];

    private static void resetArray(double[] arr) {
      for (int i = 0; i < arr.length; i++) {
        arr[i] = 0;
      }
    }

    public void reset() {
      MatrixDecompositionContext.resetArray(perspective);
      MatrixDecompositionContext.resetArray(scale);
      MatrixDecompositionContext.resetArray(skew);
      MatrixDecompositionContext.resetArray(translation);
      MatrixDecompositionContext.resetArray(rotationDegrees);
    }
  }

  private static boolean isZero(double d) {
    if (Double.isNaN(d)) {
      return false;
    }
    return Math.abs(d) < EPSILON;
  }

  public static void multiplyInto(double[] out, double[] a, double[] b) {
    double a00 = a[0],
        a01 = a[1],
        a02 = a[2],
        a03 = a[3],
        a10 = a[4],
        a11 = a[5],
        a12 = a[6],
        a13 = a[7],
        a20 = a[8],
        a21 = a[9],
        a22 = a[10],
        a23 = a[11],
        a30 = a[12],
        a31 = a[13],
        a32 = a[14],
        a33 = a[15];

    double b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[4];
    b1 = b[5];
    b2 = b[6];
    b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[8];
    b1 = b[9];
    b2 = b[10];
    b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

    b0 = b[12];
    b1 = b[13];
    b2 = b[14];
    b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }

  /** @param transformMatrix 16-element array of numbers representing 4x4 transform matrix */
  public static void decomposeMatrix(double[] transformMatrix, MatrixDecompositionContext ctx) {
    Assertions.assertCondition(transformMatrix.length == 16);

    // output values
    final double[] perspective = ctx.perspective;
    final double[] scale = ctx.scale;
    final double[] skew = ctx.skew;
    final double[] translation = ctx.translation;
    final double[] rotationDegrees = ctx.rotationDegrees;

    // create normalized, 2d array matrix
    // and normalized 1d array perspectiveMatrix with redefined 4th column
    if (isZero(transformMatrix[15])) {
      return;
    }
    double[][] matrix = new double[4][4];
    double[] perspectiveMatrix = new double[16];
    for (int i = 0; i < 4; i++) {
      for (int j = 0; j < 4; j++) {
        double value = transformMatrix[(i * 4) + j] / transformMatrix[15];
        matrix[i][j] = value;
        perspectiveMatrix[(i * 4) + j] = j == 3 ? 0 : value;
      }
    }
    perspectiveMatrix[15] = 1;

    // test for singularity of upper 3x3 part of the perspective matrix
    if (isZero(determinant(perspectiveMatrix))) {
      return;
    }

    // isolate perspective
    if (!isZero(matrix[0][3]) || !isZero(matrix[1][3]) || !isZero(matrix[2][3])) {
      // rightHandSide is the right hand side of the equation.
      // rightHandSide is a vector, or point in 3d space relative to the origin.
      double[] rightHandSide = {matrix[0][3], matrix[1][3], matrix[2][3], matrix[3][3]};

      // Solve the equation by inverting perspectiveMatrix and multiplying
      // rightHandSide by the inverse.
      double[] inversePerspectiveMatrix = inverse(perspectiveMatrix);
      double[] transposedInversePerspectiveMatrix = transpose(inversePerspectiveMatrix);
      multiplyVectorByMatrix(rightHandSide, transposedInversePerspectiveMatrix, perspective);
    } else {
      // no perspective
      perspective[0] = perspective[1] = perspective[2] = 0d;
      perspective[3] = 1d;
    }

    // translation is simple
    for (int i = 0; i < 3; i++) {
      translation[i] = matrix[3][i];
    }

    // Now get scale and shear.
    // 'row' is a 3 element array of 3 component vectors
    double[][] row = new double[3][3];
    for (int i = 0; i < 3; i++) {
      row[i][0] = matrix[i][0];
      row[i][1] = matrix[i][1];
      row[i][2] = matrix[i][2];
    }

    // Compute X scale factor and normalize first row.
    scale[0] = v3Length(row[0]);
    row[0] = v3Normalize(row[0], scale[0]);

    // Compute XY shear factor and make 2nd row orthogonal to 1st.
    skew[0] = v3Dot(row[0], row[1]);
    row[1] = v3Combine(row[1], row[0], 1.0, -skew[0]);

    // Now, compute Y scale and normalize 2nd row.
    scale[1] = v3Length(row[1]);
    row[1] = v3Normalize(row[1], scale[1]);
    skew[0] /= scale[1];

    // Compute XZ and YZ shears, orthogonalize 3rd row
    skew[1] = v3Dot(row[0], row[2]);
    row[2] = v3Combine(row[2], row[0], 1.0, -skew[1]);
    skew[2] = v3Dot(row[1], row[2]);
    row[2] = v3Combine(row[2], row[1], 1.0, -skew[2]);

    // Next, get Z scale and normalize 3rd row.
    scale[2] = v3Length(row[2]);
    row[2] = v3Normalize(row[2], scale[2]);
    skew[1] /= scale[2];
    skew[2] /= scale[2];

    // At this point, the matrix (in rows) is orthonormal.
    // Check for a coordinate system flip.  If the determinant
    // is -1, then negate the matrix and the scaling factors.
    double[] pdum3 = v3Cross(row[1], row[2]);
    if (v3Dot(row[0], pdum3) < 0) {
      for (int i = 0; i < 3; i++) {
        scale[i] *= -1;
        row[i][0] *= -1;
        row[i][1] *= -1;
        row[i][2] *= -1;
      }
    }

    // Now, get YX shear and make 2nd row orthogonal to 1st.
    skew[0] = v3Dot(row[0], row[1]);
    row[1] = v3Combine(row[1], row[0], 1.0, -skew[0]);

    // Now, get ZX and ZY shears and make 3rd row orthogonal to 1st.
    skew[1] = v3Dot(row[0], row[2]);
    row[2] = v3Combine(row[2], row[0], 1.0, -skew[1]);

    // Now, get ZY shear and make 3rd row orthogonal to 2nd.
    skew[2] = v3Dot(row[1], row[2]);
    row[2] = v3Combine(row[2], row[1], 1.0, -skew[2]);

    // Next, get Z scale and normalize 3rd row.
    scale[2] = v3Length(row[2]);
    row[2] = v3Normalize(row[2], scale[2]);
    skew[1] /= scale[2];
    skew[2] /= scale[2];

    // At this point, the matrix (in rows) is orthonormal.
    // Check for a coordinate system flip.  If the determinant
    // is -1, then negate the matrix and the scaling factors.
    pdum3 = v3Cross(row[1], row[2]);
    if (v3Dot(row[0], pdum3) < 0) {
      for (int i = 0; i < 3; i++) {
        scale[i] *= -1;
        row[i][0] *= -1;
        row[i][1] *= -1;
        row[i][2] *= -1;
      }
    }

    // Now, get X skew and remove it from 2nd row.
    skew[0] = v3Dot(row[0], row[1]);
    row[1] = v3Combine(row[1], row[0], 1.0, -skew[0]);

    // Now, get Y skew and remove it from 3rd row.
    skew[1] = v3Dot(row[0], row[2]);
    row[2] = v3Combine(row[2], row[0], 1.0, -skew[1]);

    // Now, get Z skew and remove it from 3rd row.
    skew[2] = v3Dot(row[1], row[2]);
    row[2] = v3Combine(row[2], row[1], 1.0, -skew[2]);

    // Next, get the rotation components.
    rotationDegrees[1] = Math.asin(-row[0][2]);
    if (Math.cos(rotationDegrees[1]) != 0) {
      rotationDegrees[0] = Math.atan2(row[1][2], row[2][2]);
      rotationDegrees[2] = Math.atan2(row[0][1], row[0][0]);
    } else {
      rotationDegrees[0] = Math.atan2(-row[2][0], row[1][1]);
      rotationDegrees[2] = 0;
    }

    // Finally, convert rotations to degrees.
    for (int i = 0; i < 3; i++) {
      rotationDegrees[i] = radToDeg(rotationDegrees[i]);
    }
  }

  private static double radToDeg(double rad) {
    return rad * (180 / Math.PI);
  }

  // matrix math utils
  private static double determinant(double[] m) {
    double det =
        m[0] * m[5] * m[10] * m[15]
            + m[0] * m[9] * m[14] * m[7]
            + m[0] * m[13] * m[6] * m[11]
            + m[4] * m[1] * m[14] * m[11]
            + m[4] * m[9] * m[2] * m[15]
            + m[4] * m[13] * m[10] * m[3]
            + m[8] * m[1] * m[6] * m[15]
            + m[8] * m[5] * m[14] * m[3]
            + m[8] * m[13] * m[2] * m[7]
            + m[12] * m[1] * m[10] * m[7]
            + m[12] * m[5] * m[2] * m[11]
            + m[12] * m[9] * m[6] * m[3]
            - m[0] * m[5] * m[14] * m[11]
            - m[0] * m[9] * m[6] * m[15]
            - m[0] * m[13] * m[10] * m[7]
            - m[4] * m[1] * m[10] * m[15]
            - m[4] * m[9] * m[14] * m[3]
            - m[4] * m[13] * m[2] * m[11]
            - m[8] * m[1] * m[14] * m[7]
            - m[8] * m[5] * m[2] * m[15]
            - m[8] * m[13] * m[6] * m[3]
            - m[12] * m[1] * m[6] * m[11]
            - m[12] * m[5] * m[10] * m[3]
            - m[12] * m[9] * m[2] * m[7];
    return det;
  }
diff --git a/node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgViewManager.java b/node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgViewManager.java
--- a/node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgViewManager.java
+++ b/node_modules/react-native-svg/android/src/main/java/com/horcrux/svg/SvgViewManager.java

