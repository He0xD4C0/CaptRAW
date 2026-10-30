import type {Point} from '@captraw/contracts';
// ART DiagonalCurve::spline_cubic_set / getVal, natural boundary conditions.
export function sampleCurve(points:Point[],count=513):number[]{
  const n=points.length;if(n<2)return Array.from({length:count},(_,i)=>i/(count-1));
  const identity=points[0].x===0&&points[n-1].x===1&&points.every(p=>Math.abs(p.x-p.y)<.000009);
  const second=new Array(n).fill(0),u=new Array(n).fill(0);
  for(let i=1;i<n-1;i++){
    const sig=(points[i].x-points[i-1].x)/(points[i+1].x-points[i-1].x),p=sig*second[i-1]+2;
    second[i]=(sig-1)/p;
    u[i]=(6*((points[i+1].y-points[i].y)/(points[i+1].x-points[i].x)-(points[i].y-points[i-1].y)/(points[i].x-points[i-1].x))/(points[i+1].x-points[i-1].x)-sig*u[i-1])/p;
  }
  for(let k=n-2;k>=0;k--)second[k]=second[k]*second[k+1]+u[k];
  return Array.from({length:count},(_,i)=>{
    const x=i/(count-1);if(identity)return x;
    if(x<points[0].x)return points[0].y;if(x>points[n-1].x)return points[n-1].y;
    let lo=0,hi=n-1;while(hi>lo+1){const mid=(hi+lo)>>1;if(points[mid].x>x)hi=mid;else lo=mid;}
    const h=points[hi].x-points[lo].x,a=(points[hi].x-x)/h,b=(x-points[lo].x)/h;
    return Math.max(0,a*points[lo].y+b*points[hi].y+((a*a*a-a)*second[lo]+(b*b*b-b)*second[hi])*h*h/6);
  });
}
