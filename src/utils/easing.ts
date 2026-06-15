export const Easing = {
  inOutCubic: (t: number) =>
    t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2,

  outExpo: (t: number) =>
    t === 1 ? 1 : 1 - Math.pow(2, -10*t),

  inOutQuart: (t: number) =>
    t < 0.5 ? 8*t*t*t*t : 1 - Math.pow(-2*t+2,4)/2,

  outBack: (t: number) => {
    const c1 = 1.70158, c3 = c1+1;
    return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2);
  },

  inOutSine: (t: number) =>
    -(Math.cos(Math.PI*t)-1)/2,

  outBounce: (t: number) => {
    const n1=7.5625, d1=2.75;
    if (t < 1/d1) return n1*t*t;
    if (t < 2/d1) return n1*(t-=1.5/d1)*t+0.75;
    if (t < 2.5/d1) return n1*(t-=2.25/d1)*t+0.9375;
    return n1*(t-=2.625/d1)*t+0.984375;
  },

  linear: (t: number) => t,
};
