import { LineChart, Line, ResponsiveContainer } from "recharts";

interface SparklineProps {
  data: { value: number }[];
  color?: string;
}

export const Sparkline = ({ data, color = "#22C8B8" }: SparklineProps) => {
  return (
    <div style={{ width: "100%", height: 40 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, bottom: 0, left: 0, right: 0 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
