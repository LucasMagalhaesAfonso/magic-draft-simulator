const oracle = 'Trample\nWhenever Felothar enters or attacks, you may sacrifice a nonland permanent. When you do, put a +1/+1 counter on each other creature you control.';

const wheneverCount = (oracle.match(/whenever/gi) || []).length;
const whenCount = (oracle.match(/when\s+(?!.*enters)/gi) || []).length;

console.log('Oracle:', oracle.substring(0, 80));
console.log('wheneverCount:', wheneverCount);
console.log('whenCount matches:', oracle.match(/when\s+(?!.*enters)/gi));
console.log('whenCount:', whenCount);
console.log('totalTriggersOracle:', wheneverCount + whenCount);
