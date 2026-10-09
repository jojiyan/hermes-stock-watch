const key=process.env.SCRAPINGANT_API_KEY;
for (const market of ["us","ca"]) {
  const url=`https://www.hermes.com/${market}/en/category/leather-goods/bags-and-clutches/womens-bags-and-clutches/`;
  const params=new URLSearchParams({url,browser:"false",proxy_country:market,proxy_type:"datacenter",timeout:"50"});
  const res=await fetch("https://api.scrapingant.com/v2/general?"+params,{headers:{"x-api-key":key}});
  const html=await res.text();
  const script=html.match(/<script[^>]*id="hermes-state"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if(!res.ok||!script){console.log(JSON.stringify({market,status:res.status,bytes:html.length,foundState:!!script}));continue;}
  const d=JSON.parse(script);
  const nodes=Object.values(d).flatMap(x=>{
    if(x && typeof x==="object"){
      const b= x.b?.products?.items; if(Array.isArray(b)) return [b];
    }
    return [];
  });
  const items=nodes.sort((a,b)=>b.length-a.length)[0]||[];
  const all=items.map(p=>({sku:p.sku,title:p.title,stock:p.stock,displayMode:p.displayMode,labelDisplayOnly:p.labelDisplayOnly,avgColor:p.avgColor,price:p.price,slug:p.slug}));
  const trueStock=all.filter(p=>p.stock?.ecom===true),falseStock=all.filter(p=>p.stock?.ecom===false);
  const target=all.filter(p=>/neo garden|garden party|lindy|picotin|birkin|kelly|constance/i.test(p.title));
  const sample=[...trueStock.slice(0,6),...falseStock.slice(0,3),...target];
  const tags=sample.map(p=>{
    const i=html.indexOf('id="grid-product-'+p.sku+'"');
    const j=i>=0?html.indexOf('id="grid-product-',i+10):-1;
    const segment=i<0?"":html.slice(i,j>i?j:i+10000);
    const label=segment.match(/<h-out-of-stock-label[^>]*>[\s\S]{0,700}?<\/h-out-of-stock-label>/i)?.[0]||"";
    return {sku:p.sku,title:p.title,ecom:p.stock?.ecom,retail:p.stock?.retail,displayMode:p.displayMode,labelDisplayOnly:p.labelDisplayOnly,outLabel:label.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,100),outTagClass:label.match(/class="([^"]+)"/)?.[1]||""};
  });
  console.log(JSON.stringify({market,status:res.status,credits:res.headers.get("ant-credits-cost"),nodeSizes:nodes.map(n=>n.length),total:all.length,ecomTrue:trueStock.length,ecomFalse:falseStock.length,target,tags},null,2));
}
