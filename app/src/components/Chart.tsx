import { useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "@/theme";

export function Chart({ data, positive }: { data: number[]; positive: boolean }) {
  const { palette } = useTheme();
  const [width, setWidth] = useState(0);
  const height = 168;
  const color = positive ? palette.up : palette.down;
  if (data.length === 0) {
    return <View style={{ height, borderRadius: 16, backgroundColor: palette.elevated }} />;
  }
  const values = data.length === 1 ? [data[0], data[0]] : data;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = min === max ? Math.abs(min) * 0.02 || 1 : (max - min) * 0.12;
  const low = min - pad;
  const high = max + pad;
  const step = width > 0 ? width / (values.length - 1) : 0;
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - low) / (high - low)) * (height - 8) - 4;
    return { x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
  const area = `${line} L${width.toFixed(2)} ${height} L0 ${height} Z`;
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ height, width: "100%" }}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity="0.28" />
              <Stop offset="1" stopColor={color} stopOpacity="0" />
            </LinearGradient>
          </Defs>
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2.25} fill="none" strokeLinejoin="round" strokeLinecap="round" />
        </Svg>
      ) : null}
    </View>
  );
}
