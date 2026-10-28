/**
 * DEV-ONLY route: the design mock-ups (src/design/preview). In a store build `__DEV__` is false, the branch below is removed
 * when the bundle is built, and the preview folder is never included — tests/mobile/design-preview-dev-only.test.ts holds this,
 * and checks the exported bundle for the preview's marker string.
 */
import React from 'react'
import { Redirect } from 'expo-router'

export default function DesignPreviewRoute() {
  if (__DEV__) {
    const { PreviewApp } = require('../src/design/preview/PreviewApp')
    return <PreviewApp />
  }
  return <Redirect href="/" />
}
