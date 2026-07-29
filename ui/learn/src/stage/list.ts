const asset = (name: string) => site.asset.url(`images/learn/xiangqi/${name}.svg`);

export type LearnerColor = 'red' | 'black';

export interface Level {
  id: number;
  title: string;
  goal: string;
  explanation: string;
  fen: string;
  moves: string[];
  color: LearnerColor;
  notation?: string;
  culture?: string;
  reading?: boolean;
}

interface LevelInput extends Omit<Level, 'id' | 'color' | 'moves'> {
  moves?: string[];
  color?: LearnerColor;
}

export interface Stage {
  id: number;
  key: string;
  code: string;
  title: string;
  subtitle: string;
  image: string;
  intro: string;
  complete: string;
  levels: Level[];
  comingSoon?: boolean;
}

export type StageNoID = Omit<Stage, 'id'>;

export interface Categ {
  key: string;
  name: string;
  description: string;
  stages: Stage[];
}

interface RawCateg extends Omit<Categ, 'stages'> {
  stages: StageNoID[];
}

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
const kings = '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1';

const levels = (items: LevelInput[]): Level[] =>
  items.map((item, index) => ({ color: 'red', moves: [], ...item, id: index + 1 }));

const read = (
  title: string,
  goal: string,
  explanation: string,
  fen = START,
  culture?: string,
): LevelInput => ({ title, goal, explanation, fen, culture, reading: true });

const rawCategs: RawCateg[] = [
  {
    key: 'board',
    name: '学1.1 · The Xiangqi Board',
    description: 'Read the battlefield: intersections, river, and palaces.',
    stages: [
      {
        key: 'board-layout',
        code: '学1.1',
        title: 'Xiangqi Board Layout',
        subtitle: 'The battlefield has 90 points',
        image: asset('board'),
        intro:
          'Xiangqi is played on the intersections of a 9 × 10 grid. The river divides the armies and each General commands from a palace.',
        complete:
          'You can now read the Xiangqi battlefield: 90 intersections, two palaces, and the river between them.',
        levels: levels([
          read(
            'Ninety intersections',
            'Study the full 9 × 10 board, then continue.',
            'Pieces stand on line intersections—not inside squares. Files run a through i; ranks run 1 through 10 from Red’s side.',
          ),
          read(
            'Why the River Matters',
            'Find the 楚河 / 漢界 river between ranks 5 and 6.',
            'The river changes the battlefield. Soldiers gain sideways movement after crossing it, while Elephants may never cross.',
            '4k4/9/9/9/4p4/4P4/9/9/9/4K4 w - - 0 1',
            '楚河漢界 (Chǔ hé Hàn jiè) recalls the frontier between the rival Chu and Han kingdoms.',
          ),
          read(
            'The Palace Explained',
            'Trace the nine points of each palace and its diagonal lines.',
            'Generals and Advisors remain inside their 3 × 3 palaces. The crossed diagonals are the Advisors’ routes.',
            '3aka3/9/9/9/9/4P4/9/9/9/3AKA3 w - - 0 1',
            'The palace is a command center, not a castle: the General’s power is constrained, so coordination matters.',
          ),
        ]),
      },
    ],
  },
  {
    key: 'pieces',
    name: '学1.2 · Xiangqi Pieces',
    description: 'Command each Chinese-character piece and learn its limits.',
    stages: [
      {
        key: 'general',
        code: '学1.2 · 1/7',
        title: 'The General · 帅 / 将',
        subtitle: 'One orthogonal point inside the palace',
        image: asset('general'),
        intro: 'The General moves one point horizontally or vertically and may never leave the palace.',
        complete: 'You can command the General inside the palace.',
        levels: levels([
          {
            title: 'Patrol the palace',
            goal: 'Follow the four highlighted palace points.',
            explanation:
              'Move one orthogonal point at a time. Diagonal movement and leaving the palace are forbidden.',
            fen: '4k4/9/4n4/9/9/9/9/4K4/9/9 w - - 0 1',
            moves: ['e3d3', 'd3d2', 'd2e2', 'e2e3'],
          },
        ]),
      },
      {
        key: 'advisor',
        code: '学1.2 · 2/7',
        title: 'The Advisors · 仕 / 士',
        subtitle: 'One diagonal point inside the palace',
        image: asset('advisor'),
        intro: 'The two Advisors guard their General along the palace diagonals.',
        complete: 'You can move an Advisor along the palace diagonals.',
        levels: levels([
          {
            title: 'Guard the command tent',
            goal: 'Move the Advisor across three palace diagonals.',
            explanation:
              'An Advisor moves exactly one point diagonally and must remain inside its own palace.',
            fen: '4k4/9/9/9/9/4p4/9/9/4A4/3K5 w - - 0 1',
            moves: ['e2f3', 'f3e2', 'e2d3'],
          },
        ]),
      },
      {
        key: 'soldier',
        code: '学1.2 · 3/7',
        title: 'The Soldiers · 兵 / 卒',
        subtitle: 'Advance; after the river, move sideways',
        image: asset('soldier'),
        intro:
          'A Soldier advances one point. After crossing the river it may also move one point sideways—but never backward.',
        complete: 'You know how a Soldier changes after crossing the river.',
        levels: levels([
          {
            title: 'Cross the river',
            goal: 'Advance twice, then maneuver sideways beyond the river.',
            explanation:
              'Before the river, only forward. Across it, forward or sideways. A Soldier never retreats and never promotes.',
            fen: '4k4/9/9/9/9/4P4/9/9/9/5K3 w - - 0 1',
            moves: ['e5e6', 'e6e7', 'e7d7', 'd7c7'],
            culture:
              '兵 and 卒 were ranks for foot soldiers. Their growing mobility evokes an army pressing deep into enemy territory.',
          },
        ]),
      },
      {
        key: 'chariot',
        code: '学1.2 · 4/7',
        title: 'The Chariots · 车',
        subtitle: 'Any distance along an open line',
        image: asset('chariot'),
        intro:
          'The Chariot is the strongest mobile piece, racing along ranks and files until another piece blocks it.',
        complete: 'You can drive a Chariot along open ranks and files.',
        levels: levels([
          {
            title: 'Command the open lines',
            goal: 'Collect every star in three straight moves.',
            explanation: 'The Chariot travels any number of unobstructed points horizontally or vertically.',
            fen: '3k5/9/9/9/9/9/9/4R4/9/5K3 w - - 0 1',
            moves: ['e3e8', 'e8b8', 'b8b5'],
          },
        ]),
      },
      {
        key: 'cannon',
        code: '学1.2 · 5/7',
        title: 'The Cannons · 炮 / 砲',
        subtitle: 'Glide freely; capture over one screen',
        image: asset('cannon'),
        intro:
          'Without capturing, a Cannon moves like a Chariot. To capture, it must jump exactly one intervening piece—the screen.',
        complete: 'You understand the Cannon’s two distinct movement modes.',
        levels: levels([
          {
            title: 'Move without a screen',
            goal: 'Glide to both stars without jumping.',
            explanation:
              'A non-capturing Cannon cannot jump. It follows an open rank or file just like a Chariot.',
            fen: '4k4/9/9/9/9/9/1C7/9/9/5K3 w - - 0 1',
            moves: ['b4b8', 'b8h8'],
          },
          {
            title: 'Fire across the screen',
            goal: 'Capture the black piece beyond exactly one screen.',
            explanation:
              'The piece at b6 is the screen. The Cannon leaps over it and captures the target at b9.',
            fen: '4k4/1r7/9/1P7/9/9/1C7/9/9/5K3 w - - 0 1',
            moves: ['b4b9'],
          },
        ]),
      },
      {
        key: 'elephant',
        code: '学1.2 · 6/7',
        title: 'The Elephants · 相 / 象',
        subtitle: 'Two diagonal points; never cross the river',
        image: asset('elephant'),
        intro:
          'An Elephant moves exactly two points diagonally. Its midpoint—the elephant eye—must be clear, and it stays on its own side of the river.',
        complete: 'You can trace the Elephant’s defensive lattice.',
        levels: levels([
          {
            title: 'Trace the defensive lattice',
            goal: 'Follow the Elephant’s three legal destinations.',
            explanation:
              'Move two points diagonally each time. Notice how the route reaches the riverbank but never crosses it.',
            fen: '4k4/9/9/9/9/9/9/9/9/2B2K3 w - - 0 1',
            moves: ['c1e3', 'e3g5', 'g5i3'],
          },
          {
            title: 'The blocked elephant eye',
            goal: 'Use the open diagonal; the Horse at d2 blocks the other eye.',
            explanation:
              'A piece on the midpoint stops the Elephant. This is called blocking the elephant eye (塞象眼).',
            fen: '4k4/9/9/9/9/9/9/9/3N5/2B2K3 w - - 0 1',
            moves: ['c1a3'],
            culture:
              '象 means elephant; 相 can mean a minister. The two armies use distinct characters for corresponding pieces.',
          },
        ]),
      },
      {
        key: 'horse',
        code: '学1.2 · 7/7',
        title: 'The Horses · 马 / 馬',
        subtitle: 'One orthogonal point, then one diagonal',
        image: asset('horse'),
        intro:
          'The Horse moves one point orthogonally, then one point diagonally outward. It does not jump: a piece on the first point blocks it.',
        complete: 'You can maneuver a Horse and recognize a blocked horse leg.',
        levels: levels([
          {
            title: 'Ride the horse path',
            goal: 'Follow the three bent moves to the far bank.',
            explanation: 'Unlike a western knight, the Horse can be blocked at the first orthogonal step.',
            fen: '4k4/9/9/9/9/9/9/9/9/1N3K3 w - - 0 1',
            moves: ['b1c3', 'c3e4', 'e4f6'],
          },
          {
            title: 'The blocked horse leg',
            goal: 'Reach d2. The Chariot on b2 blocks routes through b2.',
            explanation:
              'From b1 the Horse must first step through b2 to reach a3 or c3, so those destinations are blocked. The route to d2 begins through c1 and remains open.',
            fen: '4k4/9/9/9/9/9/9/9/1R7/1N3K3 w - - 0 1',
            moves: ['b1d2'],
            culture: '蹩马腿—“hobbling the horse’s leg”—is a foundational Xiangqi blocking idea.',
          },
        ]),
      },
    ],
  },
  {
    key: 'fundamentals',
    name: '学1.3–1.4 · Capture & Victory',
    description: 'Capture correctly, give check, and recognize six essential mating shapes.',
    stages: [
      {
        key: 'capture-mechanics',
        code: '学1.3',
        title: 'How Pieces Capture',
        subtitle: 'Ordinary captures and the Cannon’s screen',
        image: asset('capture'),
        intro:
          'Most pieces capture exactly as they move. The Cannon alone changes its geometry when capturing.',
        complete: 'You can distinguish ordinary captures from the Cannon’s screen capture.',
        levels: levels([
          {
            title: 'Ordinary capturing mechanics',
            goal: 'Capture the black Chariot with your Chariot.',
            explanation:
              'Chariot, Horse, Soldier, Advisor, Elephant, and General capture on a point they could legally move to.',
            fen: '4k4/r8/9/9/9/9/9/9/9/R4K3 w - - 0 1',
            moves: ['a1a9'],
          },
          {
            title: 'How the Cannon captures',
            goal: 'Use the red Soldier as a screen and capture the target.',
            explanation:
              'A Cannon capture requires exactly one piece—of either color—between Cannon and target.',
            fen: '4k4/4r4/9/4P4/9/9/4C4/9/9/4K4 w - - 0 1',
            moves: ['e4e9'],
          },
          {
            title: 'Multi-move capture example',
            goal: 'Sweep both targets with the Chariot.',
            explanation: 'After each capture, re-read the open lines before choosing the next one.',
            fen: '3k5/9/9/p3p4/9/9/9/9/9/R4K3 w - - 0 1',
            moves: ['a1a7', 'a7e7'],
          },
        ]),
      },
      {
        key: 'checkmate-foundations',
        code: '学1.4',
        title: 'How to Win · Checkmate',
        subtitle: 'Six classical mating patterns',
        image: asset('checkmate'),
        intro:
          'You win by checkmating the opposing General—or by leaving the opponent with no legal move. Xiangqi has no drawn stalemate.',
        complete: 'You have met six core Xiangqi mating patterns and their traditional names.',
        levels: levels([
          {
            title: 'Centroid Pawn Attack · Chariot method',
            goal: 'Advance the Chariot into the palace center at e9.',
            explanation:
              'The central Chariot checks; the two advanced Soldiers seal the side exits, and the Red General protects the Chariot through the open file.',
            fen: '4k4/3PaP3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
            culture:
              '小鬼坐龙廷—“the little ghost sits in the dragon court”—places an advanced Soldier at the heart of the palace.',
          },
          {
            title: 'Double Chariot Checkmate',
            goal: 'Advance the checking Chariot beside its partner.',
            explanation: 'The Chariot on e9 seals the escape and protects the Chariot that checks from d9.',
            fen: '3k5/R3R4/1N7/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['a9d9'],
            culture: '双车错 describes the interlocking action of two Chariots.',
          },
          {
            title: 'Double Cannon Checkmate',
            goal: 'Stack the Cannons on the central file.',
            explanation:
              'The rear Cannon uses the front Cannon as its screen, creating a powerful palace battery.',
            fen: '3aka3/9/9/9/9/4C4/9/C8/9/5K3 w - - 0 1',
            moves: ['a3e3'],
            culture: '重炮杀 literally means a “stacked cannon” kill.',
          },
          {
            title: 'Horse-behind-Cannon Checkmate',
            goal: 'Slide the Cannon behind the Horse to complete the battery.',
            explanation:
              'The Cannon checks through the Horse; the Horse covers d10 and f10, while the Chariot seals e9.',
            fen: '4k4/R8/4N4/C8/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['a7e7'],
            culture:
              '马后炮—“Cannon behind the Horse” in common English naming—pairs the two pieces into a classic mating battery.',
          },
          {
            title: 'Centroid Pawn Attack · Soldier method',
            goal: 'Advance the Soldier into the palace center at e9.',
            explanation:
              'The Soldier gives check from the dragon court. The rear Chariot protects it, and the two far-bank Soldiers seal d10 and f10.',
            fen: '2P1k1P2/9/4P4/9/9/9/9/9/9/4RK3 w - - 0 1',
            moves: ['e8e9'],
            culture:
              '小鬼坐龙廷 gives a humble Soldier an imperial seat—the pattern’s poetry is part of Xiangqi culture.',
          },
          {
            title: 'Elbow Horse Checkmate',
            goal: 'Jump the Horse to b8—the elbow post beside the palace.',
            explanation:
              'The Horse checks the General on d9. Three advanced Soldiers cover every palace escape without blocking the Horse’s leg.',
            fen: '2P6/3k5/4P4/3P5/N8/9/9/9/9/5K3 w - - 0 1',
            moves: ['a6b8'],
            culture: '卧槽马—“the Horse lying by the trough”—names the Horse’s post beside the enemy palace.',
          },
        ]),
      },
    ],
  },
  {
    key: 'rules',
    name: '学2 · Rules & Language',
    description: 'Master the flying-General law and read Xiangqi notation.',
    stages: [
      {
        key: 'flying-general',
        code: '学2.1',
        title: 'Flying General Rule',
        subtitle: 'The Generals may never face unobstructed',
        image: asset('flying-general'),
        intro:
          'The two Generals may not face each other on the same file without a piece between them. A move that exposes the file is illegal; the General can also capture along that open file.',
        complete: 'You can spot flying-General checks, pins, and mating nets.',
        levels: levels([
          {
            title: 'Flying General & White-Faced General · Chariot',
            goal: 'Advance the Chariot to e9 under the Red General’s protection.',
            explanation:
              'The General protects through the open file: Black cannot capture the Chariot without illegally facing the Red General. The Soldiers seal both side exits.',
            fen: '4k4/3PaP3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
            culture:
              '白脸将 / 对面笑—“white-faced General” or “smile across the board”—describes the exposed face-to-face command line.',
          },
          {
            title: 'White-Faced General · Double Cannon',
            goal: 'Shift the rear Cannon onto the central file.',
            explanation: 'The General’s open-file pressure combines with a stacked Cannon battery.',
            fen: '3aka3/9/9/9/9/4C4/9/C8/9/4K4 w - - 0 1',
            moves: ['a3e3'],
          },
          {
            title: 'Palcorner Horse enabled by a flying-General pin',
            goal: 'Jump the Horse to the palace-corner attack point at b8.',
            explanation:
              'The Horse gives the decisive check while the advanced Soldiers seal the palace. In full positions, a flying-General pin commonly prevents the central defender from answering this jump.',
            fen: '2P6/3k5/4P4/3P5/N8/9/9/9/9/5K3 w - - 0 1',
            moves: ['a6b8'],
            culture: '挂角马 places the Horse at the “hanging corner” of the palace.',
          },
          {
            title: 'Old Soldier Searches the Mountain',
            goal: 'Advance the veteran Soldier into the dragon court at e9.',
            explanation:
              'The Soldier checks; the Red General protects it through the file, and the far-bank Soldiers close both side exits.',
            fen: '2P1k1P2/9/4P4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
            culture:
              '老卒搜山—“the old Soldier searches the mountain”—celebrates a far-advanced Soldier that keeps hunting.',
          },
        ]),
      },
      {
        key: 'notation',
        code: '学2.2',
        title: 'Xiangqi Notation',
        subtitle: 'Read WXF move language',
        image: asset('notation'),
        intro:
          'WXF notation names a piece and file, then uses + to advance, − to retreat, or = to move horizontally.',
        complete: 'You can read the building blocks of Xiangqi notation from both sides.',
        levels: levels([
          read(
            'Notation explained',
            'Learn the three-part move sentence.',
            'Piece + origin file + action/destination. Red counts files from its right; Black also counts from its own right, so each side sees file 1 on its right.',
            START,
          ),
          {
            title: 'Notation example · C8=5',
            goal: 'Move the Cannon horizontally from file 8 to file 5.',
            explanation:
              'C names the Cannon, 8 is its origin file, = means horizontal, and 5 is the destination file.',
            notation: 'C8=5',
            fen: '4k4/9/9/9/9/9/1C7/9/9/5K3 w - - 0 1',
            moves: ['b4e4'],
          },
          {
            title: 'Notation example · H7+6',
            goal: 'Advance the Horse from file 7 toward file 6.',
            explanation: 'For a Horse, the final digit is the destination file.',
            notation: 'H7+6',
            fen: '4k4/9/9/9/9/9/9/9/9/2N2K3 w - - 0 1',
            moves: ['c1d3'],
          },
          {
            title: 'Notation example · E3+5',
            goal: 'Advance the Elephant from file 3 to file 5.',
            explanation:
              'E names the Elephant in WXF notation, followed by its origin and destination files.',
            notation: 'E3+5',
            fen: '4k4/9/9/9/9/9/9/9/9/5KB2 w - - 0 1',
            moves: ['g1e3'],
          },
          {
            title: 'Front and rear pieces · −R+2',
            goal: 'Advance the rear Chariot two points.',
            explanation:
              'When identical pieces share a file, front/rear markers disambiguate them. Here the rear Chariot advances two points.',
            notation: '−R+2',
            fen: '4k4/9/9/9/9/9/R8/9/9/R4K3 w - - 0 1',
            moves: ['a1a3'],
          },
          {
            title: 'Advisor and General · A4+5 / K5=4',
            goal: 'Advance the Advisor to file 5, then shift the General to file 4.',
            explanation:
              'A4+5 is diagonal; K5=4 is horizontal. Destination files are always stated for these pieces.',
            notation: 'A4+5 · K5=4',
            fen: '3k5/9/9/9/9/9/9/9/9/4KA3 w - - 0 1',
            moves: ['f1e2', 'e1f1'],
          },
          {
            title: 'Notation from Black’s side',
            goal: 'Move Black’s right-side Horse toward the center.',
            explanation:
              'Black numbers files from Black’s own right. The coordinate view rotates conceptually even when the board stays Red-side-up.',
            notation: 'h2+3',
            fen: '1n2k4/9/9/9/9/9/9/9/9/5K3 b - - 0 1',
            moves: ['b10c8'],
            color: 'black',
          },
          read(
            'Famous game · Sacrificing the Horse in Thirteen Moves',
            'Recognize how notation preserves a complete game record.',
            '弃马十三着 is studied as a compact attacking classic. Read each move as a sentence: piece, file, and action. A later lesson can add the full annotated score without changing this notation system.',
            START,
            'Traditional game records connect modern learners to centuries of Xiangqi study and commentary.',
          ),
        ]),
      },
    ],
  },
  {
    key: 'killing-methods',
    name: '学3 · Basic Killing Methods',
    description: 'One interactive example for every named classical pattern.',
    stages: [
      {
        key: 'chariot-kills',
        code: '学3.1',
        title: 'Chariot Killing Methods',
        subtitle: 'Four palace-breaking patterns',
        image: asset('chariot'),
        intro:
          'Chariots dominate open ranks and files. These patterns show how they coordinate with each other and the palace geometry.',
        complete: 'You recognize four foundational Chariot killing methods.',
        levels: levels([
          {
            title: 'Double Chariots · 双车错',
            goal: 'Advance the checking Chariot beside its partner.',
            explanation: 'The Chariot on e9 seals the escape and protects the Chariot that checks from d9.',
            fen: '3k5/R3R4/1N7/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['a9d9'],
          },
          {
            title: 'Throat Cutting · 大刀剜心',
            goal: 'Drive the Chariot into the throat of the palace.',
            explanation:
              'The central Chariot checks through the throat while the advanced Soldiers and Red General remove every reply.',
            fen: '4k4/3PaP3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
          },
          {
            title: 'Two E-Eye Chariot Attack · 双车胁士',
            goal: 'Interlock the two Chariots across the palace eyes.',
            explanation:
              'One Chariot checks while the other controls the adjacent palace point and protects its partner.',
            fen: '3k5/R3R4/1N7/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['a9d9'],
          },
          {
            title: 'Moon Scooping · 海底捞月',
            goal: 'Lift the Chariot from below into the palace center.',
            explanation:
              'The Chariot “scoops the moon from the sea floor”; the General’s long support and the Soldiers finish the net.',
            fen: '4k4/3PaP3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
          },
        ]),
      },
      {
        key: 'horse-kills',
        code: '学3.2',
        title: 'Horse Killing Methods',
        subtitle: 'Eight ways to seal the palace',
        image: asset('horse'),
        intro:
          'Horse patterns are named for the post the Horse occupies and the silhouette its control points create.',
        complete: 'You recognize eight classical Horse mating posts.',
        levels: levels([
          {
            title: 'Single Horse Captures the King · 单马擒王',
            goal: 'Ride the Horse to d8 for the decisive check.',
            explanation:
              'The Horse checks directly while the three advanced Soldiers close every palace exit.',
            fen: '2P1k1P2/9/4P4/9/2N6/9/9/9/9/5K3 w - - 0 1',
            moves: ['c6d8'],
          },
          {
            title: 'Elbow Horse · 卧槽马',
            goal: 'Jump the Horse to b8—the elbow beside the palace.',
            explanation:
              'The Horse checks the General on d9; the Soldiers cover d10, d8, and e9 without blocking its leg.',
            fen: '2P6/3k5/4P4/3P5/N8/9/9/9/9/5K3 w - - 0 1',
            moves: ['a6b8'],
          },
          {
            title: 'Palcorner Horse · 挂角马',
            goal: 'Hang the Horse on the palace corner at d8.',
            explanation:
              'The corner Horse checks while the far-bank Soldiers and central Soldier seal the palace.',
            fen: '2P1k1P2/9/4P4/9/2N6/9/9/9/9/5K3 w - - 0 1',
            moves: ['c6d8'],
          },
          {
            title: 'Angler Horse · 钓鱼马',
            goal: 'Finish with the Chariot while the Horse “fishes” from c8.',
            explanation:
              'The c8 Horse protects e9 and covers d10; the advanced Soldier closes the other side.',
            fen: '4k4/4aP3/2N1R4/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['e8e9'],
          },
          {
            title: 'High Angler Horse / Tiger Silhouette · 高钓马 / 侧面虎',
            goal: 'Finish with the Chariot beside the tiger Horse.',
            explanation: 'The Horse on d7 protects e9 while the two far-bank Soldiers close the side exits.',
            fen: '2P1k1P2/4a4/4R4/3N5/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['e8e9'],
          },
          {
            title: 'Octagonal Horse · 八角马',
            goal: 'Reach the palace corner whose control radiates outward.',
            explanation:
              'The d8 Horse delivers check from a palace corner—the characteristic octagonal post.',
            fen: '2P1k1P2/9/4P4/9/2N6/9/9/9/9/5K3 w - - 0 1',
            moves: ['c6d8'],
          },
          {
            title: 'Spring Horse · 拔簧马',
            goal: 'Release the Horse from e9 like a spring.',
            explanation:
              'The Horse jumps to c8, uncovering the Chariot’s check while also controlling d10 and e9.',
            fen: '4k4/4N4/4R4/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['e9c8'],
          },
          {
            title: 'Double Horses · 双马饮泉',
            goal: 'Advance the Chariot between the two Horses.',
            explanation: 'The Horses on c8 and g8 cover both side exits and protect the checking Chariot.',
            fen: '4k4/4a4/2N1R1N2/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['e8e9'],
          },
        ]),
      },
      {
        key: 'cannon-kills',
        code: '学3.3',
        title: 'Cannon Killing Methods',
        subtitle: 'Eight screen-and-battery patterns',
        image: asset('cannon'),
        intro:
          'Cannon mating methods are built around screens: creating them, removing them, and stacking batteries through the palace.',
        complete: 'You recognize eight essential Cannon mating batteries.',
        levels: levels([
          {
            title: 'Double Cannons · 重炮杀',
            goal: 'Stack the rear Cannon behind the front Cannon.',
            explanation: 'The front Cannon becomes the rear Cannon’s screen.',
            fen: '3aka3/9/9/9/9/4C4/9/C8/9/5K3 w - - 0 1',
            moves: ['a3e3'],
          },
          {
            title: 'Heaven and Earth Cannons · 天地炮',
            goal: 'Place the second Cannon on the lower palace line.',
            explanation:
              'One Cannon attacks from “heaven” and the other from “earth,” controlling perpendicular palace lines.',
            fen: '3aka3/9/4C4/9/9/9/9/C8/9/5K3 w - - 0 1',
            moves: ['a3e3'],
          },
          {
            title: 'Smothered Cannon · 闷宫',
            goal: 'Slide the Cannon to e8 and fire through the palace screen.',
            explanation:
              'The screen on e9 and the sealed side exits leave the General smothered inside the palace.',
            fen: '2P1k1P2/4N4/2N5C/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['i8e8'],
          },
          {
            title: 'Iron Bolt · 铁门栓',
            goal: 'Bolt the palace with the Chariot on e9.',
            explanation:
              'The central Cannon pins both Advisors: capturing the Chariot would merely replace its screen and preserve the Cannon check.',
            fen: '3aka3/R8/2N6/9/4C4/9/9/9/9/5K3 w - - 0 1',
            moves: ['a9e9'],
          },
          {
            title: 'Horse Cannon Checkmate · 马后炮',
            goal: 'Slide the Cannon behind the Horse.',
            explanation:
              'The Horse covers d10 and f10, the Chariot seals e9, and the Cannon checks through the Horse.',
            fen: '4k4/R8/4N4/C8/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['a7e7'],
          },
          {
            title: 'Cannons Sandwiching Chariot · 夹车炮',
            goal: 'Move the Chariot into the Cannon net at e9.',
            explanation:
              'The two Cannons and Chariot crowd the same wing; the central Cannon pins the palace defenders while the Chariot checks.',
            fen: '3aka3/R8/2N6/9/2C1C4/9/9/9/9/5K3 w - - 0 1',
            moves: ['a9e9'],
          },
          {
            title: 'Crowning Checkmate · 平顶冠',
            goal: 'Raise the Cannon to the flat crown at e8.',
            explanation:
              'The Cannon caps the palace through the e9 screen while every royal exit is covered.',
            fen: '2P1k1P2/4N4/2N5C/9/9/9/9/9/9/5K3 w - - 0 1',
            moves: ['i8e8'],
          },
          {
            title: 'Double Toast · 双杯献酒',
            goal: 'Offer the rear Cannon behind its partner.',
            explanation:
              'The two Cannons form the paired cups: the front Cannon is the screen for the rear Cannon’s mate.',
            fen: '3aka3/9/9/9/9/4C4/9/C8/9/5K3 w - - 0 1',
            moves: ['a3e3'],
          },
        ]),
      },
      {
        key: 'soldier-kills',
        code: '学3.4',
        title: 'Soldier Killing Methods',
        subtitle: 'Four advanced-Soldier nets',
        image: asset('soldier'),
        intro: 'Across the river, Soldiers can take away palace exits with remarkable economy.',
        complete: 'You recognize four advanced-Soldier killing formations.',
        levels: levels([
          {
            title: 'Double Ghosts Knocking · 二鬼拍门',
            goal: 'Move the left Soldier to e9 and knock on both palace doors.',
            explanation:
              'The checking Soldier is protected by the Chariot; its partner closes f10 while the far-bank Soldier closes d10.',
            fen: '4k4/3P1P3/9/9/9/9/9/9/9/3R1K3 w - - 0 1',
            moves: ['d9e9'],
          },
          {
            title: 'Three Chariots Harassing Advisor · 三车闹士',
            goal: 'Advance the Soldier—the army’s third Chariot—into e9.',
            explanation:
              'Two literal Chariots frame the attack while the palace Soldier delivers the check under central Chariot protection.',
            fen: '4k4/5P3/4P4/9/9/9/9/9/5K3/3RR4 w - - 0 1',
            moves: ['e8e9'],
          },
          {
            title: 'Centroid Pawn Attack · 小鬼坐龙廷',
            goal: 'Seat the Soldier in the palace center at e9.',
            explanation:
              'The Soldier occupies the dragon court, gives check, and is protected by the rear Chariot while the side exits are sealed.',
            fen: '2P1k1P2/9/4P4/9/9/9/9/9/9/4RK3 w - - 0 1',
            moves: ['e8e9'],
          },
          {
            title: 'Repatriation of Buddha · 送佛归殿',
            goal: 'Escort the veteran Soldier into e9.',
            explanation:
              'The Red General supports the Soldier through the open file and sends the enemy General “back to the hall” with no legal exit.',
            fen: '2P1k1P2/9/4P4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
          },
        ]),
      },
      {
        key: 'general-kills',
        code: '学3.5',
        title: 'General Killing Methods',
        subtitle: 'The open-file command weapon',
        image: asset('general'),
        intro:
          'The General is confined, but its long open-file relation to the opposing General can decide the game.',
        complete: 'You can recognize the White-Faced General killing method.',
        levels: levels([
          {
            title: 'White-Faced General · 白脸将 / 对面笑 / 千里照面',
            goal: 'Advance the Chariot to e9 under the Red General’s gaze.',
            explanation:
              'The Red General protects the checking Chariot through the open file, so Black cannot capture it; the two Soldiers close the remaining exits.',
            fen: '4k4/3PaP3/4R4/9/9/9/9/9/9/4K4 w - - 0 1',
            moves: ['e8e9'],
            culture:
              'Its names evoke commanders facing across a thousand li, or smiling at each other across the battlefield.',
          },
        ]),
      },
    ],
  },
  {
    key: 'tactics',
    name: '业1 · Basic Tactics',
    description: 'Win material, trade with purpose, and build a practice habit.',
    stages: [
      {
        key: 'material-gain',
        code: '业1.1',
        title: 'Material Gain · 得子',
        subtitle: 'Traps, pins, skewers, and forks',
        image: asset('abacus'),
        intro: 'Basic tactics turn coordination and geometry into a concrete material advantage.',
        complete: 'You can identify four common ways to win material.',
        levels: levels([
          {
            title: 'Winning a trapped piece · 困子得子',
            goal: 'Close the last escape route with the Chariot.',
            explanation: 'A trapped piece has no safe point. Restrict first; capture next.',
            fen: '4k4/9/9/9/9/9/9/2n6/9/R4K3 w - - 0 1',
            moves: ['a1c1'],
          },
          {
            title: 'Winning by pinning · 牵制得子',
            goal: 'Pin the defender to the General’s file.',
            explanation: 'The pinned piece cannot move without exposing its General.',
            fen: '4k4/4n4/9/9/9/9/9/9/9/R4K3 w - - 0 1',
            moves: ['a1e1'],
          },
          {
            title: 'Winning by skewer · 串打',
            goal: 'Check the General and line up the loose Chariot behind it.',
            explanation:
              'The General on d10 must answer the check; the Chariot on e10 is then left behind on the same rank.',
            fen: '3kr4/9/9/9/9/9/9/9/9/R4K3 w - - 0 1',
            moves: ['a1a10'],
          },
          {
            title: 'Fork / double attack · 捉双得子',
            goal: 'Fork the General and Chariot with the Horse.',
            explanation: 'From d8 the Horse checks the General on e10 and also attacks the Chariot on f9.',
            fen: '4k4/5r3/9/9/2N6/9/9/9/9/3K5 w - - 0 1',
            moves: ['c6d8'],
          },
        ]),
      },
      {
        key: 'exchanges',
        code: '业1.2',
        title: 'Exchanges · 兑换',
        subtitle: 'Trade for material, initiative, or relief',
        image: asset('exchange'),
        intro: 'An exchange is good only when the resulting position serves your plan.',
        complete: 'You can name three strategic reasons to exchange pieces.',
        levels: levels([
          {
            title: 'Trade to win material · 兑子得子',
            goal: 'Exchange the Chariot and win the loose Cannon behind it.',
            explanation:
              'Calculate beyond the first capture: the second capture determines the material result.',
            fen: '4k4/9/9/9/9/9/4c4/4r4/9/R4K3 w - - 0 1',
            moves: ['a1e1'],
          },
          {
            title: 'Trade to gain initiative · 兑子争先',
            goal: 'Exchange the defender and open the attacking file.',
            explanation:
              'A simplifying capture can gain time when it opens a forcing line against the palace.',
            fen: '4k4/4a4/9/9/9/9/4R4/9/9/4K4 w - - 0 1',
            moves: ['e4e9'],
          },
          {
            title: 'Trade to relieve pressure · 兑子解围',
            goal: 'Exchange the attacking Cannon before it builds a battery.',
            explanation:
              'When under pressure, removing the attacker can be more valuable than preserving every piece.',
            fen: '4k4/9/9/9/9/9/4c4/9/4R4/4K4 w - - 0 1',
            moves: ['e2e4'],
          },
        ]),
      },
      {
        key: 'practice-tactics',
        code: '业1.3',
        title: 'How to Practice Tactics',
        subtitle: 'A repeatable thinking method',
        image: asset('scroll'),
        intro:
          'Good practice is deliberate: scan forcing moves, calculate replies, then review what you missed.',
        complete: 'You have a practical routine for improving tactical vision.',
        levels: levels([
          read(
            'The three-pass method',
            'Use Checks → Captures → Threats on every position.',
            'First list all checks. Then inspect profitable captures. Finally look for threats such as pins, forks, and trapped pieces. Calculate the opponent’s strongest reply before moving.',
            START,
            '棋谱 study—replaying and annotating game records—has long been central to Xiangqi improvement.',
          ),
        ]),
      },
    ],
  },
  {
    key: 'road-ahead',
    name: '业2–8 · The Road Ahead',
    description: 'The complete learning path is mapped; these courses are being prepared.',
    stages: [
      ['业2', 'Opening Principles', 'Development, key lines and points, symmetry, imbalance, and tempo'],
      [
        '业3',
        'Midgame Tactics',
        'Initiative, combinations, sacrifices, interference, deflection, and disruption',
      ],
      ['业4', 'Endgame Basics', 'Fundamental Chariot, Horse, Cannon, and Soldier endgames'],
      ['业5', 'Advanced Checkmating Patterns', 'Continuous check, delayed mate, and defense-to-countermate'],
      ['业6', 'Midgame Strategy', 'Plans, breakthroughs, coordination, simplification, and evaluation'],
      ['业7', 'Practical Endgames', 'Common single- and double-Chariot, mixed-piece, and Soldier endings'],
      ['业8', 'Opening Structures', 'Aggressive, slow, and dynamic Cannon and Horse systems'],
    ].map(([code, title, subtitle]) => ({
      key: `coming-${code}`,
      code,
      title,
      subtitle,
      image: asset('mountain'),
      intro: subtitle,
      complete: '',
      levels: [],
      comingSoon: true,
    })),
  },
];

let stageId = 1;
export const categs: Categ[] = rawCategs.map(category => ({
  ...category,
  stages: category.stages.map(stage => ({ ...stage, id: stageId++ })),
}));

export const list: Stage[] = categs.flatMap(category => category.stages);
export const availableStages = list.filter(stage => !stage.comingSoon);
export const byId: Record<number, Stage> = Object.fromEntries(list.map(stage => [stage.id, stage]));
export const byKey: Record<string, Stage> = Object.fromEntries(list.map(stage => [stage.key, stage]));

export function stageIdToCategId(id: number): number | undefined {
  const found = categs.findIndex(category => category.stages.some(stage => stage.id === id));
  return found >= 0 ? found : undefined;
}

export const totalInteractiveLevels = availableStages.reduce((sum, stage) => sum + stage.levels.length, 0);
export { START as XIANGQI_START_FEN, kings as GENERALS_ONLY_FEN };
