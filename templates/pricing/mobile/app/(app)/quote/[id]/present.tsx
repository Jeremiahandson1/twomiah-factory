import { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Pressable,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { useQuote } from '@/hooks/useQuote';
import { PresentSlide } from '@/components/PresentSlide';
import { InflationChart } from '@/components/InflationChart';

const SLIDES = [
  'inclusions',
  'credibility',
  'inflation',
  '1yr',
  '30day',
  'buy_today_explain',
  'buy_today_price',
  'financing',
  'close',
] as const;

type SlideName = (typeof SLIDES)[number];

export default function PresentQuoteScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { quote, loadQuote, setStatus, save } = useQuote();
  const [currentSlide, setCurrentSlide] = useState(0);
  const [showRepOverlay, setShowRepOverlay] = useState(false);
  const translateX = useSharedValue(0);
  const { width: screenWidth } = Dimensions.get('window');

  useEffect(() => {
    if (id) loadQuote(id);
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, [id]);

  useEffect(() => {
    if (quote && quote.status === 'draft') {
      setStatus('presented');
      save();
    }
  }, [quote?.id]);

  const goNext = () => {
    if (currentSlide < SLIDES.length - 1) {
      setCurrentSlide((prev) => prev + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const goPrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide((prev) => prev - 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const swipeGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = e.translationX;
    })
    .onEnd((e) => {
      if (e.translationX < -50) {
        runOnJS(goNext)();
      } else if (e.translationX > 50) {
        runOnJS(goPrev)();
      }
      translateX.value = withSpring(0);
    });

  const longPressGesture = Gesture.LongPress()
    .minDuration(500)
    .onEnd(() => {
      runOnJS(setShowRepOverlay)(true);
    });

  const composed = Gesture.Race(swipeGesture, longPressGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value * 0.3 }],
  }));

  const formatCurrency = (amount: number) =>
    `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const renderSlideContent = (slide: SlideName) => {
    if (!quote) return null;

    switch (slide) {
      case 'inclusions':
        return (
          <PresentSlide title="What's Included">
            <View className="flex-1 justify-center px-12">
              {quote.lines.map((line, i) => (
                <View key={i} className="flex-row items-center mb-4">
                  <View className="w-3 h-3 bg-primary rounded-full mr-4" />
                  <Text className="text-xl text-white">{line.product_name}</Text>
                  <Text className="text-lg text-white/60 ml-auto">
                    {line.measurement} {line.measurement_unit}
                  </Text>
                </View>
              ))}
              {quote.lines.some((l) => l.addons.length > 0) && (
                <View className="mt-6 pt-4 border-t border-white/20">
                  <Text className="text-lg text-white/80 mb-2">Add-ons included:</Text>
                  {quote.lines.flatMap((l) =>
                    l.addons.map((a, i) => (
                      <Text key={`${l.id}-${i}`} className="text-base text-white/60 ml-4">
                        + {a.name}
                      </Text>
                    ))
                  )}
                </View>
              )}
            </View>
          </PresentSlide>
        );

      case 'credibility':
        return (
          <PresentSlide title="Why Choose Us">
            <View className="flex-1 justify-center px-12">
              <Text className="text-2xl text-white mb-6">
                Licensed, bonded, and insured professionals
              </Text>
              <Text className="text-2xl text-white mb-6">
                Manufacturer-certified installation
              </Text>
              <Text className="text-2xl text-white mb-6">
                Warranty backed by both manufacturer and us
              </Text>
              <Text className="text-2xl text-white">
                Thousands of satisfied customers
              </Text>
            </View>
          </PresentSlide>
        );

      case 'inflation':
        return (
          <PresentSlide title="Material & Labor Trends">
            <View className="flex-1 justify-center px-8">
              <InflationChart />
              <Text className="text-sm text-white/50 mt-4 text-center">
                Source: Bureau of Labor Statistics (BLS)
              </Text>
            </View>
          </PresentSlide>
        );

      case '1yr':
        return (
          <PresentSlide title="1-Year Price Lock">
            <View className="flex-1 justify-center items-center px-12">
              <Text className="text-xl text-white/70 mb-4">
                Price valid for 1 year from today
              </Text>
              <Text className="text-6xl font-bold text-white mb-4">
                {formatCurrency(quote.subtotal)}
              </Text>
              <Text className="text-lg text-white/50">
                Lock in today's material costs
              </Text>
            </View>
          </PresentSlide>
        );

      case '30day':
        return (
          <PresentSlide title="30-Day Special">
            <View className="flex-1 justify-center items-center px-12">
              <Text className="text-xl text-white/70 mb-4">
                Sign within 30 days
              </Text>
              <Text className="text-6xl font-bold text-accent mb-4">
                {formatCurrency(quote.subtotal * 0.95)}
              </Text>
              <Text className="text-lg text-white/50">
                5% discount applied automatically
              </Text>
            </View>
          </PresentSlide>
        );

      case 'buy_today_explain':
        return (
          <PresentSlide title="Buy Today Advantage">
            <View className="flex-1 justify-center px-12">
              <Text className="text-2xl text-white mb-6">
                When you commit today, you save the most:
              </Text>
              <Text className="text-xl text-white/80 mb-3">
                - No return visit required (saves us overhead)
              </Text>
              <Text className="text-xl text-white/80 mb-3">
                - Immediate scheduling priority
              </Text>
              <Text className="text-xl text-white/80 mb-3">
                - Maximum discount applied
              </Text>
              <Text className="text-xl text-white/80">
                - Guaranteed material pricing
              </Text>
            </View>
          </PresentSlide>
        );

      case 'buy_today_price':
        return (
          <PresentSlide title="Today's Price">
            <View className="flex-1 justify-center items-center px-12">
              <Text className="text-lg text-white/50 mb-2 line-through">
                {formatCurrency(quote.subtotal)}
              </Text>
              <Text className="text-7xl font-bold text-success mb-4">
                {formatCurrency(quote.total_price)}
              </Text>
              {quote.discount_amount > 0 && (
                <Text className="text-xl text-accent">
                  You save {formatCurrency(quote.discount_amount)}
                </Text>
              )}
            </View>
          </PresentSlide>
        );

      case 'financing':
        return (
          <PresentSlide title="Financing Options">
            <View className="flex-1 justify-center px-12">
              <Text className="text-2xl text-white mb-6">
                Affordable monthly payments available
              </Text>
              <View className="bg-white/10 rounded-2xl p-6 mb-4">
                <Text className="text-lg text-white/70">60 months at 0% APR*</Text>
                <Text className="text-4xl font-bold text-white mt-2">
                  {formatCurrency(quote.total_price / 60)}/mo
                </Text>
              </View>
              <View className="bg-white/10 rounded-2xl p-6">
                <Text className="text-lg text-white/70">120 months at 6.99% APR</Text>
                <Text className="text-4xl font-bold text-white mt-2">
                  {formatCurrency((quote.total_price * 1.0699) / 120)}/mo
                </Text>
              </View>
              <Text className="text-xs text-white/30 mt-4">
                *Subject to credit approval. Terms may vary.
              </Text>
            </View>
          </PresentSlide>
        );

      case 'close':
        return (
          <PresentSlide title="Ready to Get Started?">
            <View className="flex-1 justify-center items-center px-12">
              <Text className="text-2xl text-white mb-8 text-center">
                Let's lock in your price and get you on the schedule.
              </Text>
              <TouchableOpacity
                className="bg-success px-12 py-5 rounded-2xl"
                onPress={() => {
                  save();
                  router.push(`/(app)/quote/${quote.id}/sign`);
                }}
                activeOpacity={0.8}
              >
                <Text className="text-white text-2xl font-bold">
                  Sign Contract
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="mt-6"
                onPress={() => router.back()}
              >
                <Text className="text-white/50 text-lg">Back to Edit</Text>
              </TouchableOpacity>
            </View>
          </PresentSlide>
        );
    }
  };

  return (
    <View className="flex-1 bg-gray-900">
      <GestureDetector gesture={composed}>
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
          {renderSlideContent(SLIDES[currentSlide])}
        </Animated.View>
      </GestureDetector>

      {/* Edge tap zones */}
      <Pressable
        className="absolute left-0 top-0 bottom-0 w-16"
        onPress={goPrev}
      />
      <Pressable
        className="absolute right-0 top-0 bottom-0 w-16"
        onPress={goNext}
      />

      {/* Slide indicators */}
      <View className="absolute bottom-4 left-0 right-0 flex-row justify-center gap-2">
        {SLIDES.map((_, i) => (
          <View
            key={i}
            className={`w-2 h-2 rounded-full ${
              i === currentSlide ? 'bg-white' : 'bg-white/30'
            }`}
          />
        ))}
      </View>

      {/* Exit button */}
      <TouchableOpacity
        className="absolute top-4 right-4 bg-white/20 rounded-full w-10 h-10 items-center justify-center"
        onPress={() => router.back()}
      >
        <Text className="text-white text-lg">X</Text>
      </TouchableOpacity>

      {/* Rep overlay */}
      {showRepOverlay && (
        <View className="absolute inset-0 bg-black/80 items-center justify-center">
          <View className="bg-white rounded-2xl p-8 mx-8 w-96">
            <Text className="text-xl font-bold text-gray-900 mb-4">Rep Panel</Text>
            <Text className="text-gray-600 mb-2">
              Slide {currentSlide + 1} of {SLIDES.length}
            </Text>
            <Text className="text-gray-600 mb-2">
              Total: {formatCurrency(quote?.total_price || 0)}
            </Text>
            <Text className="text-gray-600 mb-6">
              Customer: {quote?.customer.name || 'N/A'}
            </Text>
            <TouchableOpacity
              className="h-12 bg-primary rounded-xl items-center justify-center"
              onPress={() => setShowRepOverlay(false)}
            >
              <Text className="text-white font-semibold">Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
