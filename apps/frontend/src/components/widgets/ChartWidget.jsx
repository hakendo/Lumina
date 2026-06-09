import ReactECharts from 'echarts-for-react';
import { useMemo } from 'react';

const COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6'];

export default function ChartWidget({ config, data }) {
  const { chartType = 'bar', xField, yField, title } = config;

  const option = useMemo(() => {
    if (!data?.length || !xField || !yField) {
      return { title: { text: title || 'Sin datos', left: 'center', top: 'middle', textStyle: { color: '#94a3b8', fontSize: 13 } } };
    }

    const xData = data.map((r) => r[xField]);
    const yData = data.map((r) => Number(r[yField]) || 0);

    const base = {
      tooltip: { trigger: 'axis' },
      color: COLORS,
      grid: { left: 40, right: 16, top: 32, bottom: 32 },
    };

    if (chartType === 'pie') {
      return {
        ...base,
        series: [{
          type: 'pie',
          radius: ['40%', '70%'],
          data: xData.map((name, i) => ({ name, value: yData[i] })),
          label: { show: true, formatter: '{b}\n{d}%' },
        }],
      };
    }

    return {
      ...base,
      xAxis: { type: 'category', data: xData, axisLabel: { rotate: xData.length > 8 ? 30 : 0, fontSize: 11 } },
      yAxis: { type: 'value' },
      series: [{
        type: chartType === 'area' ? 'line' : chartType,
        data: yData,
        areaStyle: chartType === 'area' ? { opacity: 0.3 } : undefined,
        smooth: chartType === 'line' || chartType === 'area',
        itemStyle: { color: COLORS[0] },
      }],
    };
  }, [data, config]);

  return (
    <div className="h-full flex flex-col">
      {title && <p className="text-xs font-semibold text-slate-600 mb-1 px-1">{title}</p>}
      <div className="flex-1 min-h-0">
        <ReactECharts option={option} style={{ height: '100%', width: '100%' }} />
      </div>
    </div>
  );
}
