/**
 * 富可视化 - 动画KPI组件
 * 无外部依赖，内联SVG+CSS动画
 */

export function generateAnimatedKpiHtml(value: number, label: string, sublabel: string, color: string, icon: string, delay: number = 0): string {
  return `
    <div style="
      background: white;
      border: 1px solid #e7e9ef;
      border-radius: 16px;
      padding: 18px;
      text-align: center;
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out ${delay}ms both;
      transition: all 0.3s ease;
    " onmouseover="this.style.transform='translateY(-4px)';this.style.boxShadow='0 12px 24px rgba(0,0,0,0.08)';" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none';">
      <div style="
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: ${color};
        transform: scaleX(0);
        transform-origin: left;
        animation: growWidth 0.8s ease-out ${delay + 200}ms forwards;
      "></div>
      <div style="font-size: 10px; color: #6b7280; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 600;">${label}</div>
      <div style="
        font-size: 28px;
        font-weight: 800;
        margin: 8px 0;
        font-variant-numeric: tabular-nums;
        color: #0f1116;
      " class="animated-number" data-target="${value}" data-delay="${delay}">¥0.00</div>
      <div style="font-size: 11px; color: #0b7a4f; display: flex; align-items: center; justify-content: center; gap: 4px;">
        <span style="font-size: 14px;">${icon}</span>
        <span>${sublabel}</span>
      </div>
      <div style="
        position: absolute;
        bottom: -20px;
        right: -20px;
        width: 80px;
        height: 80px;
        background: ${color}08;
        border-radius: 50%;
        animation: pulse 2s infinite;
      "></div>
    </div>
  `;
}

export function generateProfitGaugeHtml(profitRate: number, profit: number, color: string, delay: number = 0): string {
  const percentage = Math.min(profitRate, 100);
  const circumference = 2 * Math.PI * 45;
  const strokeDasharray = `${(percentage / 100) * circumference} ${circumference}`;
  
  return `
    <div style="
      background: #0f1116;
      color: white;
      border-radius: 16px;
      padding: 18px;
      text-align: center;
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out ${delay}ms both;
    ">
      <div style="font-size: 10px; color: #9ca3af; letter-spacing: 0.5px;">利润率</div>
      <div style="position: relative; width: 120px; height: 70px; margin: 12px auto;">
        <svg width="120" height="70" viewBox="0 0 120 70" style="overflow: visible;">
          <path d="M 15 60 A 45 45 0 0 1 105 60" fill="none" stroke="#1f2937" stroke-width="8" stroke-linecap="round"/>
          <path d="M 15 60 A 45 45 0 0 1 105 60" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"
                stroke-dasharray="${strokeDasharray}"
                stroke-dashoffset="0"
                style="animation: drawArc 1.2s ease-out ${delay}ms forwards; transform-origin: center;"/>
          <circle cx="60" cy="60" r="3" fill="white" style="animation: pulse 2s infinite;"/>
        </svg>
        <div style="position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); text-align: center;">
          <div style="font-size: 22px; font-weight: 800;" class="animated-number" data-target="${profitRate}" data-suffix="%">0%</div>
        </div>
      </div>
      <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">¥${profit.toFixed(2)}利润</div>
      <div style="
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);
        animation: shimmer 2s infinite;
      "></div>
    </div>
  `;
}

export const KPI_ANIMATIONS_CSS = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes growWidth {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }
  @keyframes drawArc {
    from { stroke-dasharray: 0 ${2 * Math.PI * 45}; }
  }
  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }
  @keyframes countUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

export const KPI_JS = `
  function animateNumbers() {
    document.querySelectorAll('.animated-number').forEach(el => {
      const target = parseFloat(el.dataset.target);
      const suffix = el.dataset.suffix || '';
      const prefix = el.textContent.includes('¥') ? '¥' : '';
      const delay = parseInt(el.dataset.delay || '0');
      const isPercent = suffix === '%';
      const isCurrency = prefix === '¥' || el.textContent.includes('¥');
      
      setTimeout(() => {
        let current = 0;
        const increment = target / 60;
        const timer = setInterval(() => {
          current += increment;
          if (current >= target) {
            current = target;
            clearInterval(timer);
          }
          if (isPercent) {
            el.textContent = current.toFixed(1) + '%';
          } else if (isCurrency) {
            el.textContent = '¥' + current.toFixed(2);
          } else {
            el.textContent = prefix + current.toFixed(target % 1 === 0 ? 0 : 2) + suffix;
          }
        }, 20);
      }, delay);
    });
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', animateNumbers);
  } else {
    animateNumbers();
  }
  
  // Respect reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('[style*="animation"]').forEach(el => {
      el.style.animation = 'none';
    });
  }
`;
