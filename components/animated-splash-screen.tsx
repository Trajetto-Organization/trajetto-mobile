import { useEffect, useRef } from "react";
import { Animated, Dimensions, Easing, Image, Text, View } from "react-native";

import { LinearGradient } from "expo-linear-gradient";
import TrajettoLogo from "../assets/images/trajetto-logo.png";

const { width, height } = Dimensions.get("window");

// Palette
const colors = {
  primary600: "#2563eb",
  primary700: "#1d4ed8",
  primary800: "#1e40af",
  sky400: "#38bdf8",
  sky500: "#0ea5e9",
  blue400: "#60a5fa",
  white: "#ffffff",
};

interface AnimatedSplashScreenProps {
  onFinish: () => void;
}

export const AnimatedSplashScreen: React.FC<AnimatedSplashScreenProps> = ({
  onFinish,
}) => {
  // Animation values
  const logoScale = useRef(new Animated.Value(0)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;

  const logoY = useRef(new Animated.Value(-30)).current;

  const glowScale = useRef(new Animated.Value(0)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  const textOpacity = useRef(new Animated.Value(0)).current;
  const textScale = useRef(new Animated.Value(0.85)).current;

  const textY = useRef(new Animated.Value(20)).current;

  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineY = useRef(new Animated.Value(15)).current;

  // Floating particles
  const particle1Opacity = useRef(new Animated.Value(0)).current;
  const particle1X = useRef(new Animated.Value(0)).current;

  const particle1Y = useRef(new Animated.Value(0)).current;
  const particle1Scale = useRef(new Animated.Value(0)).current;

  const particle2Opacity = useRef(new Animated.Value(0)).current;
  const particle2X = useRef(new Animated.Value(0)).current;

  const particle2Y = useRef(new Animated.Value(0)).current;
  const particle2Scale = useRef(new Animated.Value(0)).current;

  const particle3Opacity = useRef(new Animated.Value(0)).current;
  const particle3X = useRef(new Animated.Value(0)).current;

  const particle3Y = useRef(new Animated.Value(0)).current;
  const particle3Scale = useRef(new Animated.Value(0)).current;

  const particle4Opacity = useRef(new Animated.Value(0)).current;
  const particle4X = useRef(new Animated.Value(0)).current;

  const particle4Y = useRef(new Animated.Value(0)).current;
  const particle4Scale = useRef(new Animated.Value(0)).current;

  // Shimmer effect
  const shimmerX = useRef(new Animated.Value(-width)).current;

  // Wave rings
  const ringScale1 = useRef(new Animated.Value(0)).current;
  const ringOpacity1 = useRef(new Animated.Value(0)).current;

  const ringScale2 = useRef(new Animated.Value(0)).current;
  const ringOpacity2 = useRef(new Animated.Value(0)).current;

  const fadeOut = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // TOTAL DURATION: 4 seconds
    const animation = Animated.sequence([
      // Phase 1: Logo entrance with particles burst (0-1.2s)
      Animated.parallel([
        Animated.parallel([
          Animated.timing(logoOpacity, {
            toValue: 1,
            duration: 600,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(logoScale, {
            toValue: 1,
            tension: 35,
            friction: 6,
            useNativeDriver: true,
          }),
          Animated.spring(logoY, {
            toValue: 0,
            tension: 35,
            friction: 6,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.delay(200),
          Animated.parallel([
            Animated.spring(glowScale, {
              toValue: 1,
              tension: 30,
              friction: 5,
              useNativeDriver: true,
            }),
            Animated.timing(glowOpacity, {
              toValue: 1,
              duration: 400,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(350),
          Animated.parallel([
            // Particle 1 - top right
            Animated.parallel([
              Animated.timing(particle1Opacity, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(particle1Scale, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.back(1.3)),
                useNativeDriver: true,
              }),
              Animated.timing(particle1X, {
                toValue: 90,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(particle1Y, {
                toValue: -90,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
            // Particle 2 - bottom right
            Animated.parallel([
              Animated.timing(particle2Opacity, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(particle2Scale, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.back(1.3)),
                useNativeDriver: true,
              }),
              Animated.timing(particle2X, {
                toValue: 85,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(particle2Y, {
                toValue: 95,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
            // Particle 3 - top left
            Animated.parallel([
              Animated.timing(particle3Opacity, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(particle3Scale, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.back(1.3)),
                useNativeDriver: true,
              }),
              Animated.timing(particle3X, {
                toValue: -95,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(particle3Y, {
                toValue: -85,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
            // Particle 4 - bottom left
            Animated.parallel([
              Animated.timing(particle4Opacity, {
                toValue: 1,
                duration: 400,
                useNativeDriver: true,
              }),
              Animated.timing(particle4Scale, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.back(1.3)),
                useNativeDriver: true,
              }),
              Animated.timing(particle4X, {
                toValue: -88,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
              Animated.timing(particle4Y, {
                toValue: 92,
                duration: 600,
                easing: Easing.out(Easing.cubic),
                useNativeDriver: true,
              }),
            ]),
          ]),
        ]),
      ]),

      // Phase 2: Wave rings expand (1.2-1.8s)
      Animated.parallel([
        Animated.sequence([
          Animated.parallel([
            Animated.timing(ringScale1, {
              toValue: 2.5,
              duration: 600,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(ringOpacity1, {
              toValue: 0,
              duration: 600,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.delay(150),
          Animated.parallel([
            Animated.timing(ringScale2, {
              toValue: 2.5,
              duration: 600,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(ringOpacity2, {
              toValue: 0,
              duration: 600,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.sequence([
          Animated.timing(ringOpacity1, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.delay(150),
          Animated.timing(ringOpacity2, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),

      // Phase 3: Brand name appears (1.8-2.4s)
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(textScale, {
          toValue: 1,
          tension: 45,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.spring(textY, {
          toValue: 0,
          tension: 45,
          friction: 7,
          useNativeDriver: true,
        }),
      ]),

      // Phase 4: Tagline slides up (2.4-2.9s)
      Animated.parallel([
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 500,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(taglineY, {
          toValue: 0,
          tension: 50,
          friction: 8,
          useNativeDriver: true,
        }),
      ]),

      // Phase 5: Shimmer effect (2.9-3.4s)
      Animated.timing(shimmerX, {
        toValue: width * 1.5,
        duration: 650,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),

      // Phase 6: Hold (3.4-3.7s)
      Animated.delay(300),

      // Phase 7: Fade out (3.7-4s)
      Animated.timing(fadeOut, {
        toValue: 0,
        duration: 300,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    animation.start(() => {
      onFinish();
    });

    return () => {
      animation.stop();
    };
  }, []);

  return (
    <Animated.View className="flex-1" style={{ opacity: fadeOut }}>
      <LinearGradient
        colors={[colors.primary800, colors.primary600, colors.sky500]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-1 items-center justify-center"
      >
        {/* Floating particles */}
        <View className="absolute items-center justify-center">
          {/* Particle 1 - Diamond */}
          <Animated.View
            style={{
              position: "absolute",
              opacity: particle1Opacity,
              transform: [
                { translateX: particle1X },
                { translateY: particle1Y },
                { scale: particle1Scale },
                { rotate: "45deg" },
              ],
            }}
          >
            <View
              className="w-5 h-5 rounded"
              style={{
                backgroundColor: colors.white,
                shadowColor: colors.white,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 12,
                elevation: 8,
              }}
            />
          </Animated.View>

          {/* Particle 2 - Circle */}
          <Animated.View
            style={{
              position: "absolute",
              opacity: particle2Opacity,
              transform: [
                { translateX: particle2X },
                { translateY: particle2Y },
                { scale: particle2Scale },
              ],
            }}
          >
            <View
              className="w-4 h-4 rounded-full"
              style={{
                backgroundColor: colors.sky400,
                shadowColor: colors.sky400,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 10,
                elevation: 8,
              }}
            />
          </Animated.View>

          {/* Particle 3 - Square */}
          <Animated.View
            style={{
              position: "absolute",
              opacity: particle3Opacity,
              transform: [
                { translateX: particle3X },
                { translateY: particle3Y },
                { scale: particle3Scale },
              ],
            }}
          >
            <View
              className="w-3.5 h-3.5 rounded-sm"
              style={{
                backgroundColor: colors.blue400,
                shadowColor: colors.blue400,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.9,
                shadowRadius: 10,
                elevation: 8,
              }}
            />
          </Animated.View>

          {/* Particle 4 - Diamond small */}
          <Animated.View
            style={{
              position: "absolute",
              opacity: particle4Opacity,
              transform: [
                { translateX: particle4X },
                { translateY: particle4Y },
                { scale: particle4Scale },
                { rotate: "30deg" },
              ],
            }}
          >
            <View
              className="w-4.5 h-4.5 rounded"
              style={{
                backgroundColor: colors.white,
                shadowColor: colors.white,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.8,
                shadowRadius: 10,
                elevation: 8,
              }}
            />
          </Animated.View>
        </View>

        {/* Wave rings */}
        <Animated.View
          className="absolute rounded-full border-2"
          style={{
            width: 200,
            height: 200,
            borderColor: colors.white,
            opacity: ringOpacity1,
            transform: [{ scale: ringScale1 }],
          }}
        />
        <Animated.View
          className="absolute rounded-full border-2"
          style={{
            width: 200,
            height: 200,
            borderColor: colors.sky400,
            opacity: ringOpacity2,
            transform: [{ scale: ringScale2 }],
          }}
        />

        {/* Main logo container */}
        <Animated.View
          className="items-center justify-center"
          style={{
            opacity: logoOpacity,
            transform: [{ scale: logoScale }, { translateY: logoY }],
          }}
        >
          {/* Glow layers */}
          <Animated.View
            className="absolute rounded-full"
            style={{
              width: 220,
              height: 220,
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            }}
          />
          <Animated.View
            className="absolute rounded-full"
            style={{
              width: 190,
              height: 190,
              backgroundColor: "rgba(255, 255, 255, 0.12)",
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            }}
          />
          <Animated.View
            className="absolute rounded-full"
            style={{
              width: 160,
              height: 160,
              backgroundColor: "rgba(255, 255, 255, 0.18)",
              opacity: glowOpacity,
              transform: [{ scale: glowScale }],
            }}
          />

          {/* Logo circle */}
          <View
            className="items-center justify-center 
            rounded-full bg-white"
            style={{
              width: 130,
              height: 130,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 12 },
              shadowOpacity: 0.4,
              shadowRadius: 20,
              elevation: 24,
            }}
          >
            <Image
              source={TrajettoLogo}
              style={{ width: 75, height: 75 }}
              resizeMode="contain"
            />
          </View>
        </Animated.View>

        {/* Brand text - Minimalista */}
        <Animated.View
          className="absolute items-center"
          style={{
            bottom: height * 0.28,
            opacity: textOpacity,
            transform: [{ scale: textScale }, { translateY: textY }],
            overflow: "hidden",
          }}
        >
          {/* Shimmer overlay */}
          <Animated.View
            style={{
              position: "absolute",
              width: 300,
              height: 100,
              backgroundColor: "rgba(255, 255, 255, 0.2)",
              transform: [{ translateX: shimmerX }, { rotate: "15deg" }],
            }}
          />

          <Text
            className="text-white 
            font-bold text-2xl"
          >
            TRAJETTO
          </Text>
        </Animated.View>

        {/* Tagline  */}
        <Animated.View
          className="absolute items-center"
          style={{
            bottom: height * 0.25,
            opacity: taglineOpacity,
            transform: [{ translateY: taglineY }],
          }}
        >
          <Text
            className="text-white/90 
            font-light tracking-wider"
          >
            Gestão de Frota
          </Text>
        </Animated.View>

        {/* Minimalist indicator */}
        <Animated.View
          className="absolute flex-row gap-2.5"
          style={{
            bottom: height * 0.12,
            opacity: taglineOpacity,
          }}
        >
          {Array.from([0, 1, 2]).map((index) => (
            <View
              key={index}
              className="w-1.5 h-1.5 
              rounded-full bg-white/40"
            />
          ))}
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
};
