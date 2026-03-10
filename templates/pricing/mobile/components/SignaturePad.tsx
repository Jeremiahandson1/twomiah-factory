import { useRef, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { Canvas, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

interface SignaturePadProps {
  onSave: (svgPath: string) => void;
}

export function SignaturePad({ onSave }: SignaturePadProps) {
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth > 768;
  const canvasHeight = isTablet ? 300 : 200;

  const [paths, setPaths] = useState<SkPath[]>([]);
  const [currentPath, setCurrentPath] = useState<SkPath | null>(null);

  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#1e3a5f'));
  paint.setStrokeWidth(3);
  paint.setStyle(1); // Stroke
  paint.setStrokeCap(1); // Round
  paint.setStrokeJoin(1); // Round
  paint.setAntiAlias(true);

  const drawGesture = Gesture.Pan()
    .onStart((e) => {
      const path = Skia.Path.Make();
      path.moveTo(e.x, e.y);
      setCurrentPath(path);
    })
    .onUpdate((e) => {
      if (currentPath) {
        currentPath.lineTo(e.x, e.y);
        setCurrentPath(Skia.Path.MakeFromSVGString(currentPath.toSVGString())!);
      }
    })
    .onEnd(() => {
      if (currentPath) {
        setPaths((prev) => [...prev, currentPath]);
        setCurrentPath(null);
      }
    })
    .minDistance(0);

  const handleClear = () => {
    setPaths([]);
    setCurrentPath(null);
  };

  const handleUndo = () => {
    setPaths((prev) => prev.slice(0, -1));
  };

  const handleSave = () => {
    if (paths.length === 0) return;
    const svgPaths = paths.map((p) => p.toSVGString()).join(' ');
    onSave(svgPaths);
  };

  const hasSignature = paths.length > 0 || currentPath !== null;

  return (
    <View className="flex-1">
      <View className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden mb-4">
        <GestureDetector gesture={drawGesture}>
          <Canvas style={{ width: '100%', height: canvasHeight }}>
            {paths.map((path, index) => (
              <Path key={index} path={path} paint={paint} />
            ))}
            {currentPath && <Path path={currentPath} paint={paint} />}
          </Canvas>
        </GestureDetector>

        <View className="absolute bottom-4 left-6 right-6 h-px bg-gray-200" />

        {!hasSignature && (
          <View className="absolute inset-0 items-center justify-center">
            <Text className="text-gray-300 text-lg">Sign here</Text>
          </View>
        )}
      </View>

      <View className="flex-row gap-3">
        <TouchableOpacity
          className="flex-1 h-12 bg-gray-100 rounded-xl items-center justify-center"
          onPress={handleClear}
          activeOpacity={0.7}
        >
          <Text className="text-gray-700 text-base font-medium">Clear</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-1 h-12 bg-gray-100 rounded-xl items-center justify-center"
          onPress={handleUndo}
          disabled={paths.length === 0}
          activeOpacity={0.7}
        >
          <Text
            className={`text-base font-medium ${
              paths.length === 0 ? 'text-gray-400' : 'text-gray-700'
            }`}
          >
            Undo
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          className={`flex-2 h-12 px-8 rounded-xl items-center justify-center ${
            hasSignature ? 'bg-primary' : 'bg-gray-300'
          }`}
          onPress={handleSave}
          disabled={!hasSignature}
          activeOpacity={0.8}
        >
          <Text
            className={`text-base font-semibold ${
              hasSignature ? 'text-white' : 'text-gray-500'
            }`}
          >
            Confirm
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
