/* 개인정보 보호 유틸: 외부 전송 전 식별자 최소화.
   완벽한 DLP가 아니라 기본 안전망이다. 학습 내용 자체는 보존하되,
   주민번호·연락처·이메일·키처럼 명백한 식별자는 마스킹한다. */
const REDACTIONS=[
  [/sk-ant-[A-Za-z0-9_-]{20,}/g,"[REDACTED_API_KEY]"],
  [/AIza[0-9A-Za-z_-]{30,}/g,"[REDACTED_API_KEY]"],
  [/\b(?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{30,}\b/g,"[REDACTED_TOKEN]"],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,"[REDACTED_TOKEN]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[REDACTED_EMAIL]"],
  [/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g,"[REDACTED_PHONE]"],
  [/\b0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}\b/g,"[REDACTED_PHONE]"],
  [/\b\d{6}[-\s]?[1-4]\d{6}\b/g,"[REDACTED_RRN]"],
  [/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,"[REDACTED_CARD]"],
  [/([가-힣]{2,}(?:시|군|구)\s+[가-힣0-9]+(?:로|길)\s*)\d+(?:-\d+)?/g,"$1[REDACTED_ADDRESS_NO]"],
];
function redactText(text){
  if(text==null)return text;
  let out=String(text);
  REDACTIONS.forEach(([re,rep])=>{out=out.replace(re,rep);});
  return out;
}
function redactValue(value){
  if(typeof value==="string")return redactText(value);
  if(Array.isArray(value))return value.map(redactValue);
  if(value&&typeof value==="object"){
    const out={};
    for(const k in value){
      if(k==="source"&&value[k]&&typeof value[k].data==="string"){
        out[k]=value[k]; // 이미지/PDF 원본은 텍스트 마스킹 불가. 호출부의 명시 동의/고지가 담당.
      }else out[k]=redactValue(value[k]);
    }
    return out;
  }
  return value;
}
function redactAiPayload(system,userContent,opts={}){
  return {
    system:redactText(system),
    userContent:redactValue(userContent),
    opts:opts&&opts.messages?{...opts,messages:redactValue(opts.messages)}:opts,
  };
}
function sanitizeAttemptForShare(a){
  if(!a||typeof a!=="object")return null;
  const out={...a};
  delete out.inkImg;delete out.figure;delete out.figureScript;delete out.text;delete out.question;delete out.model;
  ["concept","unit","gap","misc"].forEach(k=>{if(out[k])out[k]=redactText(out[k]);});
  return out;
}
function sanitizeSharedDoc(doc){
  return {
    ...doc,
    name:redactText(doc.name||""),
    attempts:(doc.attempts||[]).map(sanitizeAttemptForShare).filter(Boolean),
    misclex:redactValue(doc.misclex||{}),
  };
}

export { redactText, redactValue, redactAiPayload, sanitizeAttemptForShare, sanitizeSharedDoc };
