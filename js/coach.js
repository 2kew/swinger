// Coaching engine — turns measured metrics + scores into granular,
// coach-style feedback with cues and drills.

export const METRIC_INFO = {
  tempo:         { name: 'Tempo',          color: 'var(--s1)', slot: 1 },
  shoulderTurn:  { name: 'Shoulder Turn',  color: 'var(--s2)', slot: 2 },
  hipTurn:       { name: 'Hip Turn',       color: 'var(--s3)', slot: 3 },
  armExtension:  { name: 'Lead Arm',       color: 'var(--s4)', slot: 4 },
  headStability: { name: 'Head Stability', color: 'var(--s5)', slot: 5 },
  posture:       { name: 'Posture',        color: 'var(--s6)', slot: 6 },
  weightShift:   { name: 'Weight Shift',   color: 'var(--s7)', slot: 7 },
  finish:        { name: 'Finish',         color: 'var(--s8)', slot: 8 },
};

export const CATEGORY_INFO = {
  timing:    'Timing',
  rotation:  'Rotation & Power',
  stability: 'Stability',
  delivery:  'Delivery',
};

export function scoreLevel(score) {
  if (score == null) return { key: 'na', label: 'N/A', css: 'muted' };
  if (score >= 80) return { key: 'good', label: 'Strong', css: 'good' };
  if (score >= 60) return { key: 'warning', label: 'Okay', css: 'warning' };
  if (score >= 40) return { key: 'serious', label: 'Needs work', css: 'serious' };
  return { key: 'critical', label: 'Priority fix', css: 'critical' };
}

const fmt = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));

export function metricValueLabel(key, m) {
  switch (key) {
    case 'tempo': return `${fmt(m.tempo, 1)} : 1`;
    case 'shoulderTurn': return `${fmt(m.shoulderTurn)}°`;
    case 'hipTurn': return `${fmt(m.hipTurn)}°`;
    case 'armExtension': return `${fmt(m.armExtension)}°`;
    case 'headStability': return `${fmt(m.headMove * 100)}% torso`;
    case 'posture': return `${fmt(m.spineChange)}° change`;
    case 'weightShift': return m.weightShift == null ? 'n/a (face-on only)' : `${fmt(m.weightShift * 100)}% stance`;
    case 'finish': return `${fmt(m.finishHipTurn)}° hips`;
    default: return '';
  }
}

// Each builder returns { analysis, why, cues[], drill:{name, how} } for the
// measured value. Text references the numbers so it reads like a real lesson.
const COACHING = {
  tempo(m, s) {
    const r = m.tempo;
    const base = `Your backswing took ${fmt(m.backswingTime, 2)}s and your downswing ${fmt(m.downswingTime, 2)}s — a tempo ratio of ${fmt(r, 1)}:1. Tour players cluster tightly around 3:1.`;
    if (s >= 80) return {
      analysis: `${base} That's right in the ideal window — your transition is unhurried and your sequencing has time to work.`,
      why: 'Great tempo lets the club shallow naturally and keeps the body and arms in sync.',
      cues: ['Keep this exact rhythm when you add speed — speed comes from sequence, not rush.'],
      drill: { name: 'Metronome check-in', how: 'Once a week, swing to a "one-two-three… ONE" count to confirm the ratio hasn\'t drifted under pressure.' },
    };
    if (r < 2.5) return {
      analysis: `${base} Yours is quicker than that, which almost always means the downswing is starting before the backswing finishes — a rushed transition.`,
      why: 'Rushing from the top throws the club over the top, costs you lag, and is the #1 source of pulls and slices.',
      cues: [
        'Feel like you pause for a full beat at the top — it will feel like an eternity but looks like nothing on video.',
        'Start the downswing from the ground up: lead hip first, hands last.',
        'Swing at 80% effort until the ratio comes back, then rebuild speed.',
      ],
      drill: { name: '1-2-3-ONE counting drill', how: 'Count "1-2-3" evenly during the backswing and say "ONE" at impact. Hit 20 half-wedges this way, then 10 full swings. The count forces a 3:1 ratio.' },
    };
    return {
      analysis: `${base} Yours is on the slow/long side — usually a backswing that drifts past the top or a downswing that never fully commits.`,
      why: 'An overly long ratio bleeds speed and makes low-point control inconsistent.',
      cues: [
        'Shorten the backswing: stop when the lead shoulder reaches your chin.',
        'From the top, feel like you accelerate through the ball, not at it.',
      ],
      drill: { name: 'Whoosh drill', how: 'Flip a club upside down, grip the shaft, and make swings that "whoosh" loudest past where the ball would be — never at the top of the downswing.' },
    };
  },

  shoulderTurn(m, s) {
    const base = `Your shoulders turned ${fmt(m.shoulderTurn)}° at the top (ideal ≈ 90°), with an X-factor of ${fmt(m.xFactor)}° over your hips.`;
    if (s >= 80) return {
      analysis: `${base} That's a full, powerful coil.`,
      why: 'A full shoulder turn stores the energy the downswing releases — you\'re loading well.',
      cues: ['Maintain this turn as you age or stiffen — mobility work protects it.'],
      drill: { name: 'Cross-arm turns', how: 'Cross your arms over your chest, take your golf posture, and make 15 full turns daily to keep the range you have.' },
    };
    if (m.shoulderTurn < 82) return {
      analysis: `${base} You're short of a full turn, so the downswing has to make up power with the arms and hands.`,
      why: 'An incomplete coil is the most common amateur power leak, and it usually shows up as an armsy, steep downswing.',
      cues: [
        'Feel your lead shoulder turn behind the ball, touching your chin at the top.',
        'Let your hips turn a little more if flexibility is the limit — resisting too hard shortens the shoulder turn.',
        'Turn your back to the target: that\'s the checkpoint, not a high hands position.',
      ],
      drill: { name: 'Back-to-target drill', how: 'Swing to the top and hold. Have the camera behind you: your shirt logo/back should face the target. Do 10 slow reps, then hit balls trying to reproduce that feeling.' },
    };
    return {
      analysis: `${base} That's more turn than you need, and an over-long backswing tends to break down the lead arm and wrists at the top.`,
      why: 'Past ~110°, extra turn stops adding speed and starts costing control and consistency.',
      cues: ['Feel "shorter and tighter" at the top — a three-quarter feel usually still films as full.'],
      drill: { name: 'Three-quarter swings', how: 'Hit 20 balls with what feels like a 75% backswing. Film one — you\'ll likely see a perfect full turn.' },
    };
  },

  hipTurn(m, s) {
    const base = `Your hips turned ${fmt(m.hipTurn)}° at the top (ideal ≈ 45°).`;
    if (s >= 80) return {
      analysis: `${base} That's the right amount of lower-body load — enough to support the shoulder turn while keeping separation.`,
      why: 'Balanced hip turn keeps the X-factor stretch that powers the downswing.',
      cues: ['Keep pressure inside the trail foot at the top — never on the outside edge.'],
      drill: { name: 'Trail-foot wall check', how: 'Set your trail foot 2cm from a wall. Swing to the top — the hip may touch, never push, the wall.' },
    };
    if (m.hipTurn < 36) return {
      analysis: `${base} Your hips are too restricted — that limits how far your shoulders can coil and adds strain on the lower back.`,
      why: 'Some hip turn is fuel for the shoulder turn. Over-restricting is a speed leak, not a power move, for most golfers.',
      cues: [
        'Let the trail hip turn back and slightly behind you going back.',
        'Allow the lead knee to work toward the ball a touch — dead-still legs lock the hips.',
      ],
      drill: { name: 'Step-back turns', how: 'Drop your trail foot back into a slightly closed stance and hit half shots — the stance pre-turns the hips and teaches the feel of a fuller turn.' },
    };
    return {
      analysis: `${base} Your hips are over-rotating, which collapses the X-factor (${fmt(m.xFactor)}°) and turns the coil into a spin.`,
      why: 'When hips and shoulders turn together there\'s no stretch to release — that\'s power lost, and it often drags the swing off plane.',
      cues: [
        'Feel the trail hip stay closer to its address position as the shoulders turn.',
        'Keep the trail knee flexed going back — a straightening trail leg lets the hips spin.',
      ],
      drill: { name: 'Chair-brush drill', how: 'Place a chair lightly touching your trail hip at address. Swing to the top keeping only light contact — if you push the chair away, the hips over-turned.' },
    };
  },

  armExtension(m, s) {
    const base = `Your lead arm measured ${fmt(m.armExtension)}° at the top (180° is dead straight; 160°+ is the goal).`;
    if (s >= 80) return {
      analysis: `${base} Excellent width — the club is on a big arc.`,
      why: 'A long lead arm keeps the swing radius wide, which is free clubhead speed.',
      cues: ['Keep this width in the downswing too — don\'t pull the arms in from the top.'],
      drill: { name: 'Width check swings', how: 'Occasionally swing with a headcover held between your forearms to keep the structure you already have.' },
    };
    return {
      analysis: `${base} The lead elbow is folding, which shrinks the swing arc and forces a re-timing flip near impact.`,
      why: 'A bent lead arm shortens the radius — you lose speed and, worse, the low point moves around, causing fat and thin strikes.',
      cues: [
        'Feel like you push your hands as far from your head as possible at the top.',
        'A shorter backswing with a straight arm beats a longer one with a bent arm every time.',
        'Check your grip pressure — a death grip makes the arm fold.',
      ],
      drill: { name: 'Split-hand swings', how: 'Grip the club with your hands 10cm apart and make slow swings — the split forces the lead arm to stay long and wide. 15 reps, then hit balls with the same feel.' },
    };
  },

  headStability(m, s) {
    const dir = m.headSway >= m.headLift ? 'side to side' : 'up and down';
    const base = `Your head moved ${fmt(m.headMove * 100)}% of your torso length from address to impact, mostly ${dir} (under ~14% is tour-like).`;
    if (s >= 80 && m.headMove <= 0.16) return {
      analysis: `${base} Rock solid — you're rotating around a stable center.`,
      why: 'A quiet head means a consistent low point, which is the foundation of pure strikes.',
      cues: ['Nothing to fix — keep letting the head rotate slightly; "still" doesn\'t mean rigid.'],
      drill: { name: 'Shadow check', how: 'On sunny days, address the ball with your head\'s shadow on a spot. Swing and watch that the shadow stays close through impact.' },
    };
    return {
      analysis: `${base} That's excess drift — your swing center is moving, so the club's low point moves with it.`,
      why: m.headSway >= m.headLift
        ? 'Lateral sway means you have to slide back exactly as far in the downswing or you hit it fat/thin. Turning beats sliding.'
        : 'Standing up (losing your levels) forces a last-instant reach for the ball — the classic cause of thin strikes and blocks.',
      cues: m.headSway >= m.headLift
        ? [
            'Feel like your trail hip turns "in place" rather than shifting away from the target.',
            'Keep your lead ear over the ball through the backswing.',
          ]
        : [
            'Keep your chest down through impact — feel like your sternum points at the ball longer.',
            'Maintain the flex in your knees from address to impact.',
          ],
      drill: { name: 'Head-on-the-wall drill', how: 'Take your posture with your head resting lightly against a wall (no club). Make slow backswing/downswing body turns keeping gentle head contact. 20 reps a day rewires the feel fast.' },
    };
  },

  posture(m, s) {
    const base = `Your spine angle changed ${fmt(m.spineChange)}° between address and impact (under 6° is ideal), and your knee flex at address measured ${fmt(m.kneeFlex)}° (~150–170° is athletic).`;
    if (s >= 80 && (m.spineChange == null || m.spineChange <= 7)) return {
      analysis: `${base} You're maintaining your posture beautifully through the strike.`,
      why: 'Holding the address tilt is what lets the club return to the ball without compensations.',
      cues: ['Keep the athletic setup — hinge from the hips, weight over mid-foot.'],
      drill: { name: 'Posture reset routine', how: 'Before each ball: stand tall, hinge from the hips until the club touches the ground, soften the knees. Same setup every time.' },
    };
    if (m.spineChange != null && m.spineChange > 6) return {
      analysis: `${base} You're losing your spine angle coming into the ball — early extension: the hips thrust toward the ball and the torso stands up.`,
      why: 'Early extension is the most common swing fault on camera. It shoves the club out toward the ball, causing blocks, hooks and heel strikes.',
      cues: [
        'Feel like your belt buckle points at the ball longer in the downswing.',
        'Keep your glutes "on the line" — as if your backside stays touching a wall behind you.',
        'Start the downswing with a small lateral bump, not a stand-up spin.',
      ],
      drill: { name: 'Wall-butt drill', how: 'Set up with your glutes lightly touching a wall. Swing to impact keeping contact — first the trail cheek going back, then the lead cheek coming down. 15 slow reps, no ball, then hit half shots.' },
    };
    return {
      analysis: `${base} Your setup posture needs attention — ${m.kneeFlex > 170 ? 'your legs are too straight, which locks the hips and makes a good turn impossible' : 'you\'re sitting too deep, which restricts rotation and drops you under the plane'}.`,
      why: 'Everything downstream depends on an athletic setup. Fix address and half your in-swing faults soften.',
      cues: [
        m.kneeFlex > 170 ? 'Soften the knees until you feel spring in your legs — weight over mid-foot.' : 'Stand a touch taller; feel hips back, chest over the ball, knees only slightly flexed.',
        'Hinge from the hips, not the waist — your back stays long, not rounded.',
      ],
      drill: { name: 'Club-down-the-spine check', how: 'Hold a club along your spine (head and tailbone touching). Hinge from the hips until your chest is over your toes, then flex the knees slightly. That\'s your address — memorize it.' },
    };
  },

  weightShift(m, s) {
    if (m.weightShift == null) return {
      analysis: 'Weight shift can\'t be measured from a down-the-line camera — record a face-on swing to score this.',
      why: 'Lateral pressure shift is only visible from the front.',
      cues: ['Film face-on (camera facing your chest, waist height) to unlock this metric.'],
      drill: null,
    };
    const pct = fmt(m.weightShift * 100);
    const base = `By impact your hips had shifted ${pct}% of your stance width toward the target (ideal ≈ 10–40%).`;
    if (s >= 80) return {
      analysis: `${base} Textbook — you're posting onto the lead side at the right time.`,
      why: 'Getting pressure to the lead side by impact moves the low point in front of the ball: compression.',
      cues: ['Keep finishing with 90%+ of your weight on the lead foot.'],
      drill: { name: 'Hold-the-finish', how: 'Hold every finish for 3 seconds, lead leg straight, trail toe down. It self-audits your shift on every swing.' },
    };
    if (m.weightShift < 0.08) return {
      analysis: `${base} You're ${m.weightShift < 0 ? 'hanging back — actually moving away from the target' : 'staying too centered'} at impact.`,
      why: 'Without a shift to the lead side, the low point stays behind the ball: fat strikes, scooping, and added loft.',
      cues: [
        'Feel your lead hip start the downswing by bumping toward the target before anything turns.',
        'At impact, your nose should be even with or ahead of the ball, never behind your trail knee.',
        'Finish with the trail heel fully off the ground, facing the target.',
      ],
      drill: { name: 'Step-through drill', how: 'Hit easy shots and let your trail foot step past your lead foot after impact, like a baseball pitcher. It\'s impossible to hang back and step through. 15 balls.' },
    };
    return {
      analysis: `${base} That's a slide — the hips are drifting past the target line instead of posting and rotating.`,
      why: 'Over-sliding drops the club too far inside and leaves the face open: blocks and snap hooks.',
      cues: [
        'Feel the lead hip turn "around the corner" — back and behind you — once it receives pressure.',
        'Post up: lead leg straightens at impact, which converts the slide into rotation.',
      ],
      drill: { name: 'Lead-wall drill', how: 'Stand with a wall (or alignment stick in the ground) just outside your lead hip. Swing without bumping it — you\'ll have to rotate instead of slide.' },
    };
  },

  finish(m, s) {
    const base = `At the finish your hips faced ${fmt(m.finishHipTurn)}° toward the target and your hands finished ${m.handsAboveShouldersAtFinish ? 'high above your shoulders' : 'low'}.`;
    if (s >= 80) return {
      analysis: `${base} A committed, balanced finish — the sign of a swing that accelerated through the ball.`,
      why: 'You can\'t fake a good finish. Balance here means the whole sequence upstream worked.',
      cues: ['Keep holding the finish until the ball lands — it trains balance on every rep.'],
      drill: { name: 'Statue finish', how: 'Hold each finish for a 3-count. If you can\'t, the swing was out of balance somewhere — instant feedback.' },
    };
    return {
      analysis: `${base} The swing is stopping short — deceleration or a balance issue is cutting off the release.`,
      why: 'An incomplete finish almost always means the body stopped rotating and the arms flipped through alone.',
      cues: [
        'Swing to a full photo-pose finish: chest and belt buckle to the target, trail toe down, hands high.',
        'Think "swing through the ball, not at it" — the ball just gets in the way.',
        'If balance fails, slow down 10% until you can hold every finish.',
      ],
      drill: { name: 'Finish-first rehearsal', how: 'Before each shot, rehearse the finish position and hold it 2 seconds. Then swing and try to land in that exact pose. 10 balls.' },
    };
  },
};

export function buildCoaching(analysis) {
  const { metrics, scores } = analysis;
  const items = Object.keys(METRIC_INFO).map((key) => {
    const score = scores[key];
    const built = COACHING[key](metrics, score ?? 0);
    return {
      key,
      name: METRIC_INFO[key].name,
      score,
      level: scoreLevel(score),
      valueLabel: metricValueLabel(key, metrics),
      ...built,
    };
  });

  const scored = items.filter((i) => i.score != null);
  const priorities = [...scored].sort((a, b) => a.score - b.score).filter((i) => i.score < 80).slice(0, 3);
  const strengths = [...scored].sort((a, b) => b.score - a.score).filter((i) => i.score >= 80).slice(0, 3);

  let summary;
  if (priorities.length === 0) {
    summary = `This is a well-rounded swing — every measured area scored in the strong band. Focus on repetition and keeping the numbers stable under pressure.`;
  } else {
    const p = priorities.map((i) => i.name.toLowerCase()).join(', then ');
    const strong = strengths[0] ? ` Your ${strengths[0].name.toLowerCase()} is a genuine strength — protect it while you work.` : '';
    summary = `Work in this order: ${p}. Fixing the lowest score first usually improves the others for free.${strong}`;
  }

  // Order: priorities first (worst → best), then the rest by ascending score.
  const rest = items.filter((i) => !priorities.includes(i)).sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  return { summary, priorities, strengths, items: [...priorities, ...rest] };
}
