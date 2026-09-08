export interface LocalizedText {
  zh: string;
  en: string;
}

export interface AncientManualGame {
  id: string;
  title: LocalizedText;
  finalFen: string;
}

export interface AncientManualChapter {
  title: LocalizedText;
  games: AncientManualGame[];
}

export interface AncientManual {
  slug: string;
  title: LocalizedText;
  chapters: AncientManualChapter[];
}

// This catalog is immutable application content. Keep it bundled with the page so
// visiting Ancient Manuals never depends on the explorer service or games database.
export const ancientManuals: readonly AncientManual[] = [
  {
    slug: 'zichudonglaiwudishou',
    title: {
      zh: '\u81ea\u51fa\u6d1e\u6765\u65e0\u654c\u624b',
      en: 'The Invincible Xiangqi Manual',
    },
    chapters: [
      {
        title: {
          zh: '1 \u201c\u81ea\u201d\u5b57 \u4fe1\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '1. "Zi" Character Casual Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:1985e24d15b352cb1c9900fd1ea60a75',
            title: {
              zh: '\u201c\u81ea\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: '\u201cZi\u201d Character, Game 1',
            },
            finalFen: '2b2kb2/4a4/2n1cN1cn/p3p3p/9/3p2P2/P1r1P3P/2N1CC3/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:6896aa26796f8b4a1dabc70f7df98e73',
            title: {
              zh: '\u201c\u81ea\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '\u201cZi\u201d Character, Game 3',
            },
            finalFen: '2Cak1b1r/5R3/3aCc2n/p7p/2pn5/6P2/P3P3P/5r3/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:0f85a8b796d2db0e60a9975d0cfb35d0',
            title: {
              zh: '\u201c\u81ea\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '\u201cZi\u201d Character, Game 2',
            },
            finalFen: '2b1k1bC1/4a4/4c1c1r/p3C1p2/9/3p2P2/P3P4/2r6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:0603166bab8b677f5ec6862d4f53e463',
            title: {
              zh: '\u201c\u81ea\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '\u201cZi\u201d Character, Game 5',
            },
            finalFen: '3a1kb1r/4an3/2Cc1c3/p2N1C2p/2p6/9/P1P1P2rP/2N5B/4A4/2BAK3R b - - 0 1',
          },
          {
            id: 'g:06f3cc16d6815bfc21142992be9dd34b',
            title: {
              zh: '\u201c\u81ea\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: '\u201cZi\u201d Character, Game 4',
            },
            finalFen: '1r1akR3/5R3/2C1b3n/p3r3p/2p4P1/9/P3P3P/9/4A4/2BAK4 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '2 \u201c\u51fa\u201d\u5b57 \u5217\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '2 "Chu" Character Opposite Direction Cannons (Five Games Total)',
        },
        games: [
          {
            id: 'g:268bc5cb1de29f63c2cfdcf475b722ef',
            title: {
              zh: '\u201c\u51fa\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: '"Chu" Character: First Game',
            },
            finalFen: '2bR2bC1/3k5/4c1c2/2p1C3p/pn1r2p2/8P/P1P1P1P2/2N6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:e91aadde2390786d6cc490771ca0edf7',
            title: {
              zh: '\u201c\u51fa\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '"Chu" Character: Third Game',
            },
            finalFen: '1rb3bC1/4kR3/4c4/2p1n1N1p/p2r5/8P/P1n1P1P2/2N6/9/1cBAKAB2 b - - 0 1',
          },
          {
            id: 'g:b5e380366efb5bf389c49e0c26eb83a5',
            title: {
              zh: '\u201c\u51fa\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '"Out" Character, Second Game',
            },
            finalFen: '1r3k1R1/4a4/1c2b4/2p1C1N1p/p2r5/8P/P1n1P1P2/2N6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:d1ee8e871345b2c83d0410c824b45cde',
            title: {
              zh: '\u201c\u51fa\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '\u201cOut\u201d Character: Game 5',
            },
            finalFen: '1rb1ka3/3R2R2/n8/p1p1C1p1p/9/6P2/P1P1P3P/2N2r3/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:660cb7de041a4b6f679a5cf703e62855',
            title: {
              zh: '\u201c\u51fa\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: 'The \u201cChu\u201d Character, Game 4',
            },
            finalFen: '1rba1nCC1/4k2R1/n2cc4/2p1p1p1p/p8/9/P1P1P3P/2r5N/9/2BAKAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '3 \u201c\u6d1e\u201d\u5b57 \u5165\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '3 "Dong" Character Entering Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:6c6946f8e7f8d2203f848a80317891a1',
            title: {
              zh: '\u201c\u6d1e\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: '"Cave" Character, First Game',
            },
            finalFen: 'r1bakRcC1/4a4/2n1b4/p1p1C3p/9/9/P1P1P1P1P/2c6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:b3bba5cbde22db221f733a85b9797430',
            title: {
              zh: '\u201c\u6d1e\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '"Dong" Character: Third Game',
            },
            finalFen: 'r1bR1nb1C/3k5/n3N4/p1p3p2/9/9/P1P2rP2/4C1c2/9/2BAKAB1c b - - 0 1',
          },
          {
            id: 'g:3d8c2a6cb6767debe4064f1be8740e24',
            title: {
              zh: '\u201c\u6d1e\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '"Dong" Character, Game 2',
            },
            finalFen: '1rb2a2C/4k2R1/n8/p1p3p2/5N3/9/P1P3P2/4C1c2/4K4/2BA1rB1c b - - 0 1',
          },
          {
            id: 'g:c6c46165fb7b4f700cf63d81fc785417',
            title: {
              zh: '\u201c\u6d1e\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '"Cave" Character, Fifth Game',
            },
            finalFen: '1r1ak1bR1/5C3/n2ab1N2/p1p5p/4r1p2/9/P1P3P1P/9/4A4/2BAK1B2 b - - 0 1',
          },
          {
            id: 'g:07f7408af7e80f7c6f3d7cf9d9e97666',
            title: {
              zh: '\u201c\u6d1e\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: '"Dong" Character: Fourth Game',
            },
            finalFen: 'r2aR4/2n1a1r2/5kN2/p1p3p1p/9/9/P1P2CP1P/5C3/6c2/2BAKAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '4 \u201c\u6765\u201d\u5b57 \u987a\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '4 "Lai" Character Same Direction Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:ec896829fb285012a664a0b3cba4160c',
            title: {
              zh: '\u201c\u6765\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: 'The \u201cLai\u201d Character, Game 1',
            },
            finalFen: '3akc1n1/4a4/1rn1C4/p1p3p1p/4C4/9/P1P3r1P/2N6/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:fd97569e1eeee4545c5e4a81e8fe41e2',
            title: {
              zh: '\u201c\u6765\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '"Lai" Character, Game 3',
            },
            finalFen: '3ak4/2Nra4/4b3R/p1p1C1p1p/9/9/P7P/2r1B4/4A4/2BA1K3 b - - 0 1',
          },
          {
            id: 'g:4f69c8f4cc77b3a77f75f20a99a65c82',
            title: {
              zh: '\u201c\u6765\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '"Lai" Character: Second Game',
            },
            finalFen: '1r1a1k1R1/2Cr5/5a3/p1p3p1p/9/4p4/P7P/2N6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:c0fe2c023b7ff9cf3c2452022d92d2dc',
            title: {
              zh: '\u201c\u6765\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '\u201cLai\u201d Character, Game 5',
            },
            finalFen: '1rb1kab2/3R1R3/2n3n2/p1p3p1p/4C4/9/P1r5P/4B4/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:0d65f14e9a71a04d72cdf73dee1eb02f',
            title: {
              zh: '\u201c\u6765\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: 'The \u201cLai\u201d Character, Game 4',
            },
            finalFen: '1rbaR4/5k3/3ab4/p1p1n1p1p/9/9/P3C3P/4B4/5C3/2BAKA3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '5 \u201c\u65e0\u201d\u5b57 \u8896\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '5 "Wu" Character Arms-Folded Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:683af68db26632ab1ca02f993fb836bc',
            title: {
              zh: '\u201c\u65e0\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: 'The \u201cWu\u201d Character, Game 1',
            },
            finalFen: 'r1b1k2R1/3R1C3/n4c3/p1p1p3p/6p2/4r4/P7P/4B1N2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:ad9d9688a3126500afdf5749ff0743d4',
            title: {
              zh: '\u201c\u65e0\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '"Wu" Character: Third Game',
            },
            finalFen: '1rbk1R3/1Cc1R4/n3c4/p3p1p1p/2p6/6P2/P1P1P3P/2N1B1r2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:c082ad18b5ca7b5b9d8922aa55f2d33e',
            title: {
              zh: '\u201c\u65e0\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: 'The \u201cWu\u201d Character, Game 2',
            },
            finalFen: 'r1b2k3/4R4/n1c1c3b/p2R5/2p1p1p2/6P2/P1P1P3P/2N1B1r2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:bf433983703fe5eb2029a0df349f90c9',
            title: {
              zh: '\u201c\u65e0\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '"Wu" Character, Game 5',
            },
            finalFen: '2b1k1b2/7R1/n1cR5/p3p1p1p/2p6/6P2/P1P1P3P/1rN1B1r2/4A4/3K1AB2 b - - 0 1',
          },
          {
            id: 'g:2b4d3558ee19a397d6bb0e7dab9e678c',
            title: {
              zh: '\u201c\u65e0\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: '\u201cWu\u201d Character, Game 4',
            },
            finalFen: 'rnb2a3/1Cc2R3/4ck2C/p3p3p/2p2n3/6P2/P1P1P3P/2N1B4/4Ar3/4KAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '6 \u201c\u654c\u201d\u5b57 \u51fa\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '6 "Di" Character Offensive Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:ce4d7f091645a75892db3a8b04516481',
            title: {
              zh: '\u201c\u654c\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: '\u201cEnemy\u201d Character, Game 1',
            },
            finalFen: '2ba4r/4ak3/4b3n/pn3Cp1p/9/5C3/P1P1P3P/2Nr4B/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:feb3e88891ece49e657810e30bf4a353',
            title: {
              zh: '\u201c\u654c\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '\u201cEnemy\u201d Character, Game 3',
            },
            finalFen: '2bak1b1r/4R4/6N1n/p3C1p2/9/8p/P1P1c3P/8B/4A4/2BK1A1r1 b - - 0 1',
          },
          {
            id: 'g:fd2eefc647cafa87aca511a3fc4bf89c',
            title: {
              zh: '\u201c\u654c\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '"Di" Character, Game 2',
            },
            finalFen: '2ba1abr1/9/5k2n/p3C1p1p/5R3/4C4/P1P5P/8B/4A4/2B1KA1r1 b - - 0 1',
          },
          {
            id: 'g:33c3f6461e386e02c95da44ffe972749',
            title: {
              zh: '\u201c\u654c\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '\u201cEnemy\u201d Character, Game 5',
            },
            finalFen: 'C1R1kab2/9/2N1ca3/p5p2/8p/9/P3P1n1P/4B4/4A4/2B1KA1r1 b - - 0 1',
          },
          {
            id: 'g:137490b3a239008ac5fc8baf4435d9a9',
            title: {
              zh: '\u201c\u654c\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: '\u201cEnemy\u201d Character, Game 4',
            },
            finalFen: '5abr1/4a4/3k2N2/p5p1p/9/2P6/P2R2P1P/3C5/9/2BAKABr1 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '7 \u201c\u624b\u201d\u5b57 \u5e94\u624b\u70ae \uff08\u5171\u4e94\u5c40\uff09',
          en: '7. "Shou" Character Response Cannon (Five Games Total)',
        },
        games: [
          {
            id: 'g:88a4de4f6a11c92201c894b492ec4182',
            title: {
              zh: '\u201c\u624b\u201d\u5b57 \u7b2c\u4e00\u5c40',
              en: '\u201cHand\u201d Character: Game 1',
            },
            finalFen: '2b1k1b2/4a1N2/2nR4n/p1p1C1p1p/4c4/8P/P8/2C6/4A1r2/2BA1KBr1 b - - 0 1',
          },
          {
            id: 'g:8009a855c64586f9bffbebb881db292b',
            title: {
              zh: '\u201c\u624b\u201d\u5b57 \u7b2c\u4e09\u5c40',
              en: '"Shou" Character, Game 3',
            },
            finalFen: '2b2kbr1/2N1a2C1/2n2R2n/p1p1p1p1p/2r6/8P/P3P1P2/2N2C3/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:d72cc6b3a62e36a43a08100e6b37f1a7',
            title: {
              zh: '\u201c\u624b\u201d\u5b57 \u7b2c\u4e8c\u5c40',
              en: '\u201cHand\u201d Character, Game 2',
            },
            finalFen: '5ab2/3ka4/2n3r1n/p1p1p1p1p/9/8P/P2C2P2/3C5/4A4/2BA1KB2 b - - 0 1',
          },
          {
            id: 'g:245ab3c21f2ca3d0cb5d28d034af40f8',
            title: {
              zh: '\u201c\u624b\u201d\u5b57 \u7b2c\u4e94\u5c40',
              en: '\u201cHand\u201d Character, Game 5',
            },
            finalFen: '2b1kab2/3R2N2/2n5n/p1p1p1p1p/2c6/8P/P5P2/2r1C4/4AK3/2BA2r2 b - - 0 1',
          },
          {
            id: 'g:45b27186886237697ae9ca7d709f255d',
            title: {
              zh: '\u201c\u624b\u201d\u5b57 \u7b2c\u56db\u5c40',
              en: '\u201cHand\u201d Character, Game 4',
            },
            finalFen: '3k1Rbr1/2n1R4/5c2n/p1p1Crp1p/9/8P/P3P1P2/2N6/9/2BAKAB2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'yicheng',
    title: {
      zh: '\u5955\u4e58',
      en: 'Yicheng',
    },
    chapters: [
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u6d77\u6d32\u6c47\u9009',
          en: 'Yicheng\u2014Collected Selections of Haizhou',
        },
        games: [
          {
            id: 'g:498682541c3d317e3027623ebf3fb92e',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u6c5f\u90fd\u5468\u5fb7\u88d5(\u5148) \u9ec4\u5188\u7f57\u5929\u9633(\u80dc)',
              en: 'Game 3: Jiangdu Zhou Deyu \u2014 Red, Huanggang Luo Tianyang \u2014 Black Wins',
            },
            finalFen: 'rnbakabr1/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKABR1 b - - 0 1',
          },
          {
            id: 'g:d96cdc75632492e8c8e83995ce00daa0',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u6c5f\u90fd\u5468\u5fb7\u88d5(\u5148) \u9ec4\u5188\u7f57\u5929\u9633(\u548c)',
              en: 'Game 2: Jiangdu Zhou Deyu vs. Huanggang Luo Tianyang \u2014 Draw',
            },
            finalFen: '2bak4/4a4/2n1b4/p5p2/2p4n1/4r3C/P1PR2c1P/N3B1N2/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:47454ca8baaf13a0ad01a25b2760b9db',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u626c\u5dde\u7aa6\u56fd\u67f1(\u5148) \u6c38\u5609\u6797\u5955\u4ed9(\u80dc)',
              en: 'Game 5: Dou Guozhu of Yangzhou vs. Lin Yixian of Yongjia \u2014 Black Wins',
            },
            finalFen: '1Cbakab2/9/3c4n/p3p1p2/1P6p/6P1P/4P2R1/3nB1NCB/4A4/3K5 w - - 0 1',
          },
          {
            id: 'g:e40986647ad0f37c72837447a08ac641',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u6c5f\u9675\u5434\u677e\u4ead(\u5148) \u9ec4\u5188\u7f57\u5929\u9633(\u80dc)',
              en: 'Game 4: Wu Songting of Jiangling vs. Luo Tianyang of Huanggang \u2014 Black Wins',
            },
            finalFen: '3rkab2/4a4/4b4/p1C6/3PC3p/6p2/1R2Pr3/7cN/9/2BAKAB2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u70c2\u67ef\u4e1b\u949e\u9009\u7cb9',
          en: 'Yicheng\u2014Selected Excerpts from Lanke Congchao',
        },
        games: [
          {
            id: 'g:ffe2069b9968982974a676e77fbe0ec3',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u6c38\u5609\u6797\u5955\u4ed9(\u5148) \u6c5f\u90fd\u5468\u7115\u6587(\u548c)',
              en: 'Game 3: Lin Yixian of Yongjia vs. Zhou Huanwen of Jiangdu \u2014 Draw',
            },
            finalFen: '2bak4/4a4/c3b1c1n/R5p1C/2p6/6P2/P1PrP3P/2N2C3/9/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:093be91edda757ebde2da8d4fb374b9d',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u5434\u53bf\u5f20\u6fb9\u5982(\u5148\u80dc) \u6c5f\u90fd\u5468\u7115\u6587',
              en: 'Game 2: Zhang Danru of Wuxian vs. Zhou Huanwen of Jiangdu \u2014 Red Wins',
            },
            finalFen: '1C1a1abr1/C4k3/4R1n2/p3p3p/9/9/P3P3P/6N2/4A4/2BAK3c b - - 0 1',
          },
          {
            id: 'g:06248bb579fad2c7110748090e6a1bae',
            title: {
              zh: '\u7b2c\u516d\u5c40\u6b66\u8fdb\u8d39\u7ef5\u94a6\u5148\u80dc\u9999\u5c71\u66fe\u5c55\u9e3f',
              en: 'Game 6: Wujin Fei Mianqin vs. Xiangshan Zeng Zhanhong \u2014 Red Wins',
            },
            finalFen: 'rRbak4/3R5/n3b1N2/2p5p/p5p2/6P2/P3P3P/N3c3B/4Ar3/3K1A3 b - - 0 1',
          },
          {
            id: 'g:188ba7b068bfe7a3bf4a359b839643aa',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u6c49\u9633\u96f7\u6d77\u5c71(\u5148) \u6c5f\u90fd\u5468\u5fb7\u88d5',
              en: 'Game 4: Lei Haishan of Hanyang vs. Zhou Deyu of Jiangdu',
            },
            finalFen: 'C2k1a3/4a4/4c4/p7p/3np1c2/9/P1r5P/4B1C2/3RA4/2B1KA3 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u9716\u751f\u6284\u5b58',
          en: 'Yicheng\u2014Copied and Preserved by Linsheng',
        },
        games: [
          {
            id: 'g:5596a95f3ef4cce061569f6a9bbb8e49',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u9ec4\u5188\u7f57\u5929\u9633(\u5148\u80dc) \u626c\u5dde\u7aa6\u56fd\u67f1',
              en: 'Game 1: Huanggang Luo Tianyang vs. Yangzhou Dou Guozhu \u2014 Red Wins',
            },
            finalFen: '3C5/C2cak3/4bc3/6N2/7Rp/9/P7P/1r7/3K5/3A1A3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u68a6\u543e\u8c61\u96c6',
          en: 'Yicheng\u2014Mengwu Xiangji',
        },
        games: [
          {
            id: 'g:7824052afc2de6b5bc49e66abfd20e9a',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u4eac\u5146\u5218\u71ee\u5982(\u5148) \u86df\u5ddd\u94b1\u68a6\u543e(\u80dc)',
              en: 'Liu Xieru of Jingzhao vs. Qian Mengwu of Jiaochuan \u2014 Red Wins',
            },
            finalFen: '2ba1kb2/4a4/9/p1C1p3p/6p2/1R2P4/P1P1N3P/N3n3B/1R1rAr3/2BAK2c1 w - - 0 1',
          },
          {
            id: 'g:798bb17680e71047ef4f43c4d0cf2c69',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u86df\u5ddd\u94b1\u68a6\u543e(\u5148\u548c) \u4eac\u5146\u5b5f\u9e64\u9f84',
              en: 'Game 3: Qian Mengwu of Jiaochuan vs. Meng Heling of Jingzhao \u2014 Draw',
            },
            finalFen: '3akab2/9/4b2r1/1C2p4/r8/9/Pc2n4/4BN3/4A4/R1BAK1R2 b - - 0 1',
          },
          {
            id: 'g:71a80bc0d4818b21ab1062d4a3a9efd0',
            title: {
              zh: '\u7b2c\u4e8c\u5c40\u5929\u6d25\u5e9e\u8c12\u5ead\u5148\u80dc\u5929\u6d25\u9648\u5f00\u6cf0',
              en: "Game 2: Tianjin's Pang Yeting Defeats Tianjin's Chen Kaitai",
            },
            finalFen: '1rb1kab2/3RaR3/n3C1n2/p1p1p3p/9/9/P1P1c3P/N3C1r2/4A4/2cK1AB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u540d\u624b\u5bf9\u5c40\u6c47\u5f55\u9009\u7cb9',
          en: "Yicheng\u2014Selected Excerpts from a Compilation of Famous Masters' Games",
        },
        games: [
          {
            id: 'g:97a3ab0233327a1ae283495e0265c8d6',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u6797\u5955\u4ed9(\u5148\u80dc) \u738b\u6d69\u7136',
              en: 'Lin Yixian vs. Wang Haoran \u2014 Red Wins',
            },
            finalFen: '3k1a2r/9/c2a5/p1p1C3p/6p2/9/P1P1N1P1P/9/9/2BK1AB1R w - - 0 1',
          },
          {
            id: 'g:59854693002227ed409a5149d7378152',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u674e\u5fd7\u82f1(\u5148\u80dc) \u5f20\u9526\u8363',
              en: 'Li Zhiying vs. Zhang Jinrong \u2014 Red Wins',
            },
            finalFen: '4kabr1/4a4/4b4/p3C3p/4P2P1/3p3R1/P1P5P/4R4/3KA4/cr3AB2 b - - 0 1',
          },
          {
            id: 'g:e416980ef602704f2e230faa5c35fb4d',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u6797\u5955\u4ed9(\u5148) \u738b\u6d69\u7136(\u80dc)',
              en: 'Game 3: Lin Yixian \u2014 Red, Wang Haoran \u2014 Black Wins',
            },
            finalFen: 'r1b1kab2/4a4/7r1/p3p3p/9/2C3R2/P1P1c1P1P/N3BRn2/4A4/2BAK4 w - - 0 1',
          },
          {
            id: 'g:e48e7e1c1277007a7029f594c908e3af',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u738b\u6d69\u7136(\u5148\u80dc) \u6797\u5955\u4ed9',
              en: 'Game 2: Wang Haoran vs. Lin Yixian \u2014 Red Wins',
            },
            finalFen: '4kab2/C3a4/4b1n2/1R2p1p1p/2p6/6P2/P1Pr3cP/4B1NC1/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:f88bdd3575ee27e6e326d3c40b64e30b',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u6797\u5955\u4ed9(\u5148\u80dc) \u5f20\u9526\u8363',
              en: 'Game 5: Lin Yixian Defeats Zhang Jinrong',
            },
            finalFen: '1Cba1kb2/4a4/2R3n2/pC2p1p1p/2p6/P5P2/2P1P3P/N8/9/2rAKAr2 w - - 0 1',
          },
          {
            id: 'g:865ac9f3b3c88111e69c6b296883e132',
            title: {
              zh: '\u7b2c\u516d\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u6797\u5955\u4ed9',
              en: 'Game 6: Zhang Jinrong vs. Lin Yixian \u2014 Red Wins',
            },
            finalFen: '2bak1b1r/4aR3/4c4/R7p/9/2P3P2/P7P/1r2B1N2/4A4/2BAK4 b - - 0 1',
          },
          {
            id: 'g:9c0d8fdc86d5bb221580493e4646cacc',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u6797\u5955\u4ed9(\u5148\u548c) \u738b\u6d69\u7136',
              en: 'Game 4: Lin Yixian vs. Wang Haoran \u2014 Draw',
            },
            finalFen: '2bak3r/4a4/c3b4/p7p/1C4p2/2B6/P5P1P/9/3R5/2BAKA3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u5185\u7f16',
          en: 'Yicheng\u2014Inner Compilation',
        },
        games: [
          {
            id: 'g:7102e86e9123e6b9ec0db9a6140d36c6',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u676d\u53bf\u5173\u6625\u6797(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 1: Hang County Guan Chunlin \u2014 Red, Pingyang Xie Xiasun \u2014 Draw',
            },
            finalFen: 'r1baka3/9/4b1nr1/p3p3p/9/1cP6/P2R4P/NC2B4/9/2BAKAR2 b - - 0 1',
          },
          {
            id: 'g:e07e8c6e90a8676589f6492f7a8326a0',
            title: {
              zh: '\u7b2c\u4e09\u5c40\u9ec4\u5188\u7f57\u5929\u626c\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u548c',
              en: 'Game 3: Luo Tianyang of Huanggang vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2ba1k3/4a4/4b1n2/p1R1p1pCp/2p6/6P2/c1r1P3P/4C4/9/3AKAB2 w - - 0 1',
          },
          {
            id: 'g:9ed82a297a4f8c1eb8bc4cb72974342d',
            title: {
              zh: '\u7b2c\u4e5d\u5c40 \u6c49\u9633\u96f7\u6d77\u5c71(\u4e8c\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Lei Haishan of Hanyang vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '3akab2/9/6r1n/p3p3p/3N1n3/P8/8P/6R2/4A4/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:d51f5da7a54fec19aa98d9eca645ad81',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e00\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u4e8c\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 21: Wan Qiyou of Jiangning (Two-Move Handicap) vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: 'r2k1ab2/4a4/4b1R2/pR2P2rp/2p6/9/8P/B8/4A4/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:b4ab52b9cfc20bcaec83d7107ecddf47',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e09\u5c40\u6c5f\u5b81\u4e07\u542f\u6709\u4e8c\u5148\u80dc\u5e73\u9633\u8c22\u4fa0\u900a',
              en: 'Game 23: Wan Qiyou of Jiangning, Two-Move Handicap \u2014 Red Wins Over Xie Xiaxun of Pingyang',
            },
            finalFen: '2bak4/3na4/4b1n2/3N2CN1/2p1p3p/P5P2/4P3P/4BA3/7c1/2BAK4 b - - 0 1',
          },
          {
            id: 'g:ff25b85b3c344b5ea1f48375e10c5ff4',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e8c\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u4e8c\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 22: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Two-Move Handicap',
            },
            finalFen: '2b1ka3/4a4/2n1b3n/p1p1p1P2/5N2p/2P6/P2c1N3/2C6/3KA4/2B2A3 w - - 0 1',
          },
          {
            id: 'g:019695619b66e8d6a163e48d5a332a85',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u5c40\u6c5f\u5b81\u4e07\u542f\u6709\u4e8c\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u548c',
              en: 'Game 20: Jiangning Wan Qiyou vs. Pingyang Xie Xiaxun \u2014 Draw',
            },
            finalFen: '2b1kab2/4a4/6n1c/p3p3p/1n1r5/2P1PR3/P4Nc1P/R1C1C1N1B/2r1A4/2BAK4 b - - 0 1',
          },
          {
            id: 'g:847d840180a6cdc3216afa9758d3a4fd',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u9ec4\u5188\u7f57\u5929\u9633(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 2: Luo Tianyang of Huanggang vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '1nbakab2/9/4c1n2/p3p1p1p/2p6/2c1P4/P3N1P1P/4C3C/9/2BAKABN1 w - - 0 1',
          },
          {
            id: 'g:595f4223c13f9310c805c9aa57b68bc4',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u676d\u53bf\u5434\u4e4b\u8c26(\u5148\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a',
              en: 'Game 5: Wu Zhiqian of Hangxian vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '2bak1b1r/4a4/7c1/p3n3p/2n1R1p2/2N1c1P2/P1C5P/C3B1N2/4A4/2BAK4 b - - 0 1',
          },
          {
            id: 'g:93e4bfe80265dafd46fa718594a8ff1d',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u676d\u53bf\u51af\u7709\u836a(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 8: Feng Meisun of Hangxian vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2bakar2/9/4b1nc1/p3pP1Cp/2p6/9/P1P5P/2N1B3B/9/1R2KA3 w - - 0 1',
          },
          {
            id: 'g:02b2c3e8f21dc09faf12f5c56565e888',
            title: {
              zh: '\u7b2c\u516d\u5c40\u676d\u53bf\u5434\u4e4b\u8c26\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u80dc',
              en: 'Game 6: Wu Zhiqian of Hangxian Defeats Xie Xiaxun of Pingyang',
            },
            finalFen: '3ak4/4a4/4b4/9/3P2brp/9/3np3r/3ABR3/9/3AKCR2 w - - 0 1',
          },
          {
            id: 'g:68655c7ef001b17f9c646ccfdd46adf0',
            title: {
              zh: '\u7b2c\u5341\u4e00\u5c40 \u5434\u53bf\u6f58\u9e23\u5c97(\u4e8c\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 11: Wuxian Pan Minggang \u2014 Second to Move, Pingyang Xie Xiasun \u2014 Draw',
            },
            finalFen: 'r2ak1c2/9/4Can2/pcp1n3R/9/9/P1P1N1P1P/1C5r1/9/R1BAKAB2 w - - 0 1',
          },
          {
            id: 'g:336f5f7bec0d85884b56c5b9bf57381b',
            title: {
              zh: '\u7b2c\u5341\u4e03\u5c40\u6c5f\u5b81\u4e07\u542f\u6709\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u548c',
              en: 'Game 17: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2baka3/9/4b1n2/p3p3p/2p6/3r5/5R3/2R1B4/4A4/2B1K4 w - - 0 1',
          },
          {
            id: 'g:df5fa37203126c06307ca182a250ca20',
            title: {
              zh: '\u7b2c\u5341\u4e09\u5c40 \u626c\u5dde\u5f20\u9526\u8363(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 13: Zhang Jinrong of Yangzhou vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '3ak4/4a4/4b4/p2Rp3p/2p6/5r3/P7P/4n4/4A3C/4KA3 w - - 0 1',
          },
          {
            id: 'g:a621d1f5bdb3d1a40cd111e721be472e',
            title: {
              zh: '\u7b2c\u5341\u4e5d\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 19: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2bak1b2/4aR3/5c3/p1p1n3p/6p2/2P2r3/P4c3/2C1CA2B/4K4/2BA5 w - - 0 1',
          },
          {
            id: 'g:fb686eaad43ed02d68228f6aa77cf906',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40\u6c5f\u9675\u5434\u677e\u4ead\u4e8c\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u80dc',
              en: 'Game 12: Jiangling Wu Songting \u2014 Second to Move, Pingyang Xie Xiasun \u2014 Wins',
            },
            finalFen: '3akabn1/4c4/b1n6/prCR2p1p/9/9/6P1P/4B1N2/2rNA4/R2K1AB2 w - - 0 1',
          },
          {
            id: 'g:7a3b05dc17d041d57f6cb7be3d416c13',
            title: {
              zh: '\u7b2c\u5341\u4e94\u5c40\u6c5f\u90fd\u5468\u5fb7\u88d5\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u548c',
              en: 'Game 15: Zhou Deyu of Jiangdu vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '3ak1b2/4a4/4b4/1RC6/2p6/9/6P1P/4CA3/4A4/rcc1K1B2 w - - 0 1',
          },
          {
            id: 'g:e251d1f703edb352a2028e81a394249a',
            title: {
              zh: '\u7b2c\u5341\u516b\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 18: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2bak1b2/4a4/7cn/p8/2p6/5p3/P1P4rP/3CB2C1/4A4/2BAK2R1 w - - 0 1',
          },
          {
            id: 'g:84bb6cc7ee0f9fa2c13308058e34fcdd',
            title: {
              zh: '\u7b2c\u5341\u516d\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 16: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '1Nba1kb2/1c7/9/p3p3p/3n2p2/2B6/P5P1c/1C2C4/4A4/3K1AB2 w - - 0 1',
          },
          {
            id: 'g:20482566eead7af86bc5f7f8b9028d35',
            title: {
              zh: '\u7b2c\u5341\u56db\u5c40\u6c38\u5609\u6797\u5955\u4ed9\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u80dc',
              en: 'Game 14: Lin Yixian of Yongjia Defeats Xie Xiaxun of Pingyang',
            },
            finalFen: '4ka3/2c6/3r1aR2/6n1p/2p1C4/5n3/4p1P1P/4B4/4A3N/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:3a4d6d7f3694b03d9d7b78a3bc9e2643',
            title: {
              zh: '\u7b2c\u5341\u5c40 \u6c5f\u5b81\u9c8d\u5b50\u6ce2(\u4e8c\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 10: Bao Zibo of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '3ak4/4a4/n1c1b3b/8R/p8/6P2/4r3P/4B1C2/N3A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:471ea88c1f7a4645cdd82d10c1f3af96',
            title: {
              zh: '\u7b2c\u56db\u5c40\u8386\u7530\u8fde\u5b66\u6b63\u5148\u5e73\u9633\u8c22\u4fa0\u900a\u80dc',
              en: 'Game 4: Lian Xuezheng of Putian Defeats Xie Xiaxun of Pingyang',
            },
            finalFen: '4kab2/4a4/4b4/R8/6p1r/3pp3C/P2c3RP/4B1r2/9/2BAKA3 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u5e73\u9633\u8c22\u4fa0\u900a\u5955\u68cb\u9009',
          en: 'Yicheng\u2014Selected Games by Xie Xiaxun of Pingyang',
        },
        games: [
          {
            id: 'g:d1d1c5f17459aa87ba63189d2c3614ba',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u7ecd\u53bf\u8d75\u4e66\u7530(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)(\u8ba9\u5de6\u9a6c)',
              en: 'Game 1: Zhao Shutian of Shaoxian vs. Xie Xiaxun of Pingyang \u2014 Red Wins (Handicap Left Horse)',
            },
            finalFen: '2bakab2/9/2R6/p3p1p1p/9/P8/4c1P1P/R5N2/2c1Ar3/5KB2 w - - 0 1',
          },
          {
            id: 'g:8bff2a3b35fc5fa6c9c2093eb419827d',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u911e\u53bf\u8521\u9e23\u9633(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Cai Mingyang of Yin County vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '2bakab2/9/2n6/p1N1p3p/2P6/P3P4/3r3nc/4B2Rr/4A4/2RAKN3 w - - 0 1',
          },
          {
            id: 'g:f0732de725d618c3c75103874783a0b8',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u6c5f\u9675\u5434\u677e\u4ead(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 3: Wu Songting of Jiangling vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2bakab2/9/9/p7p/2r6/9/P3p3P/4B4/8R/R2AKABr1 b - - 0 1',
          },
          {
            id: 'g:8141375091ede85ec495577ea94432c5',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e00\u5c40 \u626c\u5dde\u5f20\u9526\u8363(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Zhang Jinrong of Yangzhou vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: 'rnbakab1r/9/1c4nc1/p1p1p1p1p/9/2P6/P3P1P1P/1CN4C1/9/R1BAKABNR b - - 0 1',
          },
          {
            id: 'g:9aac661051aa54984d531f95c9fa0025',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e03\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 27: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '3a1k3/4a4/4b4/p3p3p/3R2b2/9/2P1P3P/2CR5/5r3/crBAKAB2 w - - 0 1',
          },
          {
            id: 'g:ff84782a78446080251d2d9666ca392a',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e09\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Game 23: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: '2bk1a3/4a4/2R1b3n/p5p1p/5P3/9/P3r3P/4C4/4A4/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:fc66add4ecd1d8c6853bf0fcf26e6e36',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e94\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709 \u5e73\u9633\u8c22\u4fa0\u900a(\u5148\u80dc)',
              en: 'Game 25: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '2ba4C/5R3/4k1C2/p3p4/9/6P2/P1n1P3P/1rN2KN2/2c6/3A1AB2 b - - 0 1',
          },
          {
            id: 'g:cfe717bd5aa81ff65bcccdad1d245391',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u516d\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a(\u5148)',
              en: 'Game 26: Jiangning Wan Qiyou vs. Pingyang Xie Xiaxun \u2014 Red Wins',
            },
            finalFen: '2baka1r1/9/2R1b1N2/p7C/4c4/9/P3P3P/8B/4Arp2/2BAK2cR w - - 0 1',
          },
          {
            id: 'g:1065256dc26268ef6873c61ba6f60b96',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u56db\u5c40 \u6c5f\u5b81\u4e07\u542f\u6709(\u5148\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a',
              en: 'Game 24: Wan Qiyou of Jiangning vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '3ak3r/4aR3/2n1b2c1/p3p1c1p/3r2p2/5NP2/P3P3P/1C2B2C1/4A4/1RBAK4 b - - 0 1',
          },
          {
            id: 'g:af6d4e7497e627ee72ad22e2be5e6784',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u5c40 \u626c\u5dde\u5f20\u9526\u8363(\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a(\u5148)',
              en: 'Zhang Jinrong of Yangzhou vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '2r1kab2/4a4/4b4/pR6p/2c1Cnp2/2N1r4/P5P1P/4B4/1R7/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:d53af6ef0f6564397a7aad92d13ba7c2',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u6c5f\u9675\u5434\u677e\u4ead(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Wu Songting of Jiangling vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '3rkab2/c3a4/1cn1b1n2/p3pRP1p/2p6/5N3/P1PCP3P/N3C4/1r2A4/R1BAK1B2 b - - 0 1',
          },
          {
            id: 'g:339957a4e7c7b8dc26611ca53317b3f1',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u626c\u5dde\u7aa6\u56fd\u67f1(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 8: Dou Guozhu of Yangzhou vs. Xie Xiaxun of Pingyang',
            },
            finalFen: '2bak4/4a4/4b2R1/p1p1n1p1p/9/6P2/P1P1P3P/4B4/1r1NA1r2/3RKAB2 b - - 0 1',
          },
          {
            id: 'g:f50ba35805d256865d70b964b1fd31fa',
            title: {
              zh: '\u7b2c\u516d\u5c40 \u5434\u53bf\u8bb8\u632f\u8446(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 6: Xu Zhenbao of Wuxian vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '4R4/4a3C/b3k4/p5p2/2pC5/9/P5n2/8r/4A4/3A1K3 w - - 0 1',
          },
          {
            id: 'g:e3e40583c081bdb0481fd75c3449ad43',
            title: {
              zh: '\u7b2c\u5341\u4e09\u5c40 \u6c5f\u90fd\u5468\u5fb7\u88d5(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u548c)',
              en: 'Zhou Deyu of Jiangdu vs. Xie Xiaxun of Pingyang \u2014 Draw',
            },
            finalFen: 'rnbakabnr/9/1c2c4/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKAB1R b - - 0 1',
          },
          {
            id: 'g:c54729c8ef314f53fa263a17063d95e6',
            title: {
              zh: '\u7b2c\u5341\u4e5d\u5c40 \u626c\u5dde\u5f20\u9526\u8363(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 19: Yangzhou Zhang Jinrong \u2014 Red, Pingyang Xie Xiasun \u2014 Black Wins',
            },
            finalFen: 'r1bakab2/9/2n1c4/p3p3p/6p2/1n7/P5P1P/4C1N2/R8/2rAKABR1 w - - 0 1',
          },
          {
            id: 'g:b5ad05f0acdc07c5c5c27530971a641e',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40 \u6c38\u5609\u6797\u5955\u4ed9(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 12: Lin Yixian of Yongjia vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '2baka3/6r2/2n1b4/p8/4p4/9/P3R3P/B3C2r1/2R6/1c2K1B2 w - - 0 1',
          },
          {
            id: 'g:0931ca11e2a0d8fe6670db0ef0a0ebda',
            title: {
              zh: '\u7b2c\u5341\u4e94\u5c40 \u6c5f\u90fd\u5468\u5fb7\u88d5(\u5148) \u5e73\u9633\u8c22\u4fa0\u900a(\u80dc)',
              en: 'Game 15: Zhou Deyu of Jiangdu vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '2rak4/4a4/4b4/p3C3p/2P6/1R2P4/P4R2P/5K1nc/4A4/2BA3r1 w - - 0 1',
          },
          {
            id: 'g:9cc50c5e20535b9e4fc744321dbe215d',
            title: {
              zh: '\u7b2c\u5341\u516b\u5c40 \u626c\u5dde\u5f20\u9526\u8363(\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a(\u5148)',
              en: 'Game 18: Zhang Jinrong of Yangzhou vs. Xie Xiaxun of Pingyang \u2014 Black Wins',
            },
            finalFen: '2b1ka3/4a4/4b4/9/9/3C2P2/P1r5P/4rn3/1R1RA4/3AK4 w - - 0 1',
          },
          {
            id: 'g:35146a03890cdc65721eae71b4311766',
            title: {
              zh: '\u7b2c\u5341\u56db\u5c40 \u6c5f\u90fd\u5468\u5fb7\u88d5(\u80dc) \u5e73\u9633\u8c22\u4fa0\u900a(\u5148)',
              en: 'Game 14: Zhou Deyu of Jiangdu vs. Xie Xiaxun of Pingyang \u2014 Red Wins',
            },
            finalFen: '2r1ka3/4a4/9/R7p/9/9/P3Pn2r/3ABc3/4A4/1R2K1B2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u77f3\u6768\u9057\u5c40',
          en: "Yicheng\u2014Shiyang's Surviving Games",
        },
        games: [
          {
            id: 'g:743369d493948bf7cbceb9f7966785ac',
            title: {
              zh: '\u7b2c\u4e00\u5c40\u3000\u5c4f\u98ce\u9a6c\u5de1\u6cb3\u70ae\u62b5\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 1: Screen Horse Defense, Riverbank Cannon Against Central Cannon \u2014 Draw',
            },
            finalFen: '1Rck1ab2/4a4/4b4/p5P1p/3r5/9/P5R1P/4C4/4A4/2rAK1B2 w - - 0 1',
          },
          {
            id: 'g:5cfaece9df0851f8119ecb980edb5da1',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u5c4f\u98ce\u9a6c\u62b5\u53f3\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 7: Screen Horse Defense Against the Right Central Cannon \u2014 Draw',
            },
            finalFen: '2ba1k3/4a4/2n1b4/p1p6/1r7/9/P1P3n2/N3C4/3RA4/2B1KAB2 w - - 0 1',
          },
          {
            id: 'g:75dffd2c8e1f2f94ee37753729cbca11',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u5c4f\u98ce\u9a6c\u62b5\u5de6\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 3: Screen Horse Defense Against the Left Central Cannon Opening \u2014 Draw',
            },
            finalFen: '2bakr3/4a4/4b4/p1R5p/4p4/P3n4/8P/2C6/4A4/2BAK1B2 w - - 0 1',
          },
          {
            id: 'g:f0418e6433c58f6d071c51aa8fa36449',
            title: {
              zh: '\u7b2c\u4e5d\u5c40 \u53f3\u5355\u63d0\u9a6c\u62b5\u53f3\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 9: Right Single Horse Defense Against Right Central Cannon \u2014 Draw',
            },
            finalFen: '3akab2/9/4b4/p3p3p/9/9/Pr2P3P/4B3R/3n5/2BAKAN2 w - - 0 1',
          },
          {
            id: 'g:de55b8ff968dea63fde8fe769b102d9d',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u5c4f\u98ce\u9a6c\u62b5\u5de6\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 2: Screen Horse Defense Counters the Left Central Cannon Formation \u2014 Draw',
            },
            finalFen: '2b1ka3/4a4/9/p3R3p/6b2/2p4r1/P7P/4B4/9/3AKA3 b - - 0 1',
          },
          {
            id: 'g:3abf4dc8f81450fa673b91214472d1be',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u5c4f\u98ce\u9a6c\u62b5\u53f3\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 5: Screen Horse Defense Against Right Central Cannon \u2014 Draw',
            },
            finalFen: '2baka1r1/r8/1cn1b2c1/p1p1p2Rp/6pn1/4P4/P1P3P1P/1CN1C1N2/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:4e2d390f58fb1d0cbf93d045aa7ad1c0',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u5de6\u5355\u63d0\u9a6c\u62b5\u53f3\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 8: Left Single Horse Defense Against the Right Central Cannon Opening \u2014 Draw',
            },
            finalFen: '3rkab2/4a4/4b4/pR4R1p/2p6/9/P1P5r/4B4/4A4/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:177c76f3ca513b61002d6952ae7bcbfc',
            title: {
              zh: '\u7b2c\u5341\u4e00\u5c40 \u5bf9\u5175\u5c40(\u7ea2\u80dc)',
              en: 'Game 11: Pawn Against Pawn \u2014 Red Wins',
            },
            finalFen: '4kab2/2c1a4/4b1r2/4p4/1R7/6PN1/P1c1n4/1Cp1B4/4A4/3NKAB2 w - - 0 1',
          },
          {
            id: 'g:8c42766a4c4f43456aa24c32e7ead215',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40 \u5bf9\u5175\u5c40(\u7ea2\u7834\u4e2d\u5352\u80dc)',
              en: 'Game 12: Pawn Against Pawn Game (Red Breaks the Central Pawn and Wins)',
            },
            finalFen: '2b1ka2R/4aR3/4b4/p2r5/1P7/2B3p2/4c3P/2Cr1C3/9/4KAB2 b - - 0 1',
          },
          {
            id: 'g:ccf91f075281b2b74bcd4aa08bb6b765',
            title: {
              zh: '\u7b2c\u5341\u5c40 \u5f53\u5934\u70ae\u62b5\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 10: Central Cannon Against Central Cannon Opening \u2014 Draw',
            },
            finalFen: '4kab2/4a4/4b4/2R5p/P8/1r4p2/8P/9/3KA4/2B2A3 b - - 0 1',
          },
          {
            id: 'g:42ab283a683ebb625fa2a34ba3fa88c0',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u5c4f\u98ce\u9a6c\u62b5\u53f3\u5f53\u5934\u70ae\u5c40(\u548c)',
              en: 'Game 4: Screen Horse Defense Against Right Central Cannon \u2014 Draw',
            },
            finalFen: '3a1kb2/4a4/4b1n2/p7p/1r7/1p4P2/P1R5P/4B1N2/4A4/4KAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u5434\u5146\u9f99\u8c61\u68cb\u8c31\u9009\u7cb9',
          en: 'Yicheng\u2014Selected Xiangqi Manuals by Wu Zhaolong',
        },
        games: [
          {
            id: 'g:7e5d9d7b8e8757ab3001865fe331ae9c',
            title: {
              zh: '\u7b2c\u4e00\u5c40\u3000\u8ba9\u5218\u5c1a\u9f84\u5355\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 1: Liu Shangling Takes the First Move in Game 1 (Wu Wins)',
            },
            finalFen: '2ba1k3/3Ra4/4b4/p7p/2p1p4/6P2/P1PNP3P/1R2B4/4Krc2/5A3 w - - 0 1',
          },
          {
            id: 'g:89b06dbf37e17ce12fa44a4b23c35c9a',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u8ba9\u5085\u745e\u5929\u53cc\u5148\u7b2c\u4e8c\u5c40(\u5085\u80dc)',
              en: 'Game 7: Allowing Fu Ruitian Two-Move Handicap, Second Game \u2014 Fu Wins',
            },
            finalFen: '2ba4R/4ak3/2n1b4/2C2r2p/p5p2/8P/P1P1cr3/N3B4/4A4/2BK1A1R1 b - - 0 1',
          },
          {
            id: 'g:9d51ab757db7f7f1db2730a5611b766d',
            title: {
              zh: '\u7b2c\u4e5d\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u4e8c\u5c40(\u65bd\u80dc)',
              en: 'Game 9: Shi Jiamo Given the First Move in Game 2 \u2014 Shi Wins',
            },
            finalFen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1',
          },
          {
            id: 'g:560797e8c849715f9ae8859b80c4b207',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u8ba9\u5218\u5c1a\u9f84\u5355\u5148\u7b2c\u4e8c\u5c40(\u5434\u80dc)',
              en: 'Game 2: Liu Shangling Given a Single-Move Handicap \u2014 Wu Wins',
            },
            finalFen: '3rkab2/4a4/4b1C2/1R2p3R/9/p1P1P1P2/3r4c/N1n1C4/4A4/2B1KAB2 w - - 0 1',
          },
          {
            id: 'g:6c15447cef86695209b36d43e85df168',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u8ba9\u5085\u745e\u5929\u5355\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 5: Fu Ruitian Given the First-Move Advantage \u2014 Wu Wins',
            },
            finalFen: 'rnbakabr1/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C1N2/9/RNBAKABR1 b - - 0 1',
          },
          {
            id: 'g:21a8ed1c5942835a6c51670642463c6b',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 8: Shi Jiamo Takes the First Move in Game 1 (Wu Wins)',
            },
            finalFen: '4ka3/4aP3/4b4/p8/9/9/Pp4c1P/B3B4/2rrAp3/1R1CKA1R1 w - - 0 1',
          },
          {
            id: 'g:fbebef5971623d837c0a46acebf92fd8',
            title: {
              zh: '\u7b2c\u516d\u5c40 \u8ba9\u5085\u745e\u5929\u53cc\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 6: Fu Ruitian Given a Double Handicap, First Game \u2014 Wu Wins',
            },
            finalFen: '1C1a5/4ak3/4b2c1/p1R2Cp1p/2p6/9/P1P1P3P/N3B4/4r4/2BK1A2r w - - 0 1',
          },
          {
            id: 'g:1c1140017160d5ea390a55af869479c2',
            title: {
              zh: '\u7b2c\u5341\u4e00\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u56db\u5c40(\u65bd\u80dc)',
              en: 'Game 11: Shi Jiamo Takes the Lead in Game 4 (Shi Wins)',
            },
            finalFen: '2baR4/5k3/2cab3r/pr6p/2p1C1P2/9/P1n1P3P/2N2C3/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:17e20740ac1e47ef0f8b2e45be267673',
            title: {
              zh: '\u7b2c\u5341\u4e09\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u516d\u5c40(\u5434\u80dc)',
              en: 'Game 13: Shi Jiamo, First in Game 6, Wu Wins',
            },
            finalFen: '1C2kab2/9/3a5/2p6/9/9/Pc7/1C2r4/3RA1p2/4KABc1 w - - 0 1',
          },
          {
            id: 'g:6b0ddd3df77e8463f7939e60db0abac5',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u4e94\u5c40(\u5434\u80dc)',
              en: 'Game 12: Handicap Shi Jiamo, Single-First Game 5 (Wu Wins)',
            },
            finalFen: '2bak4/1C7/4b4/3r5/p7p/4c2n1/P2RP3P/3A5/9/2B1K1B2 w - - 0 1',
          },
          {
            id: 'g:b77f0faa43dab8197929953f0e3d9506',
            title: {
              zh: '\u7b2c\u5341\u4e94\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u516b\u5c40(\u5434\u80dc)',
              en: 'Game 15: Shi Jiamo, First in Game 8, Wu Wins',
            },
            finalFen: 'rnbakabnr/9/1c5c1/p3p1p1p/2p6/6P2/P1P1P3P/1C5C1/9/RNBAKABNR w - - 0 1',
          },
          {
            id: 'g:7eb44e4ef2afc7721d52fdfbe2c2a0c8',
            title: {
              zh: '\u7b2c\u5341\u516d\u5c40 \u8ba9\u5ba3\u624d\u5b9d\u5355\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 16: Handicap Xuan Caibao, Single-First Game 1 (Wu Wins)',
            },
            finalFen: 'r1bakab1r/9/1cn3nc1/p3p1p1p/2p6/5NP2/P1P1P3P/4C2C1/9/RNBAKAB1R b - - 0 1',
          },
          {
            id: 'g:c89553e74a477a01ba9f7853aeac18a8',
            title: {
              zh: '\u7b2c\u5341\u56db\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u4e03\u5c40(\u5434\u80dc)',
              en: 'Game 14: Shi Jiamo Given the First Move in Game 7 \u2014 Wu Wins',
            },
            finalFen: '2ba1k3/2N1a4/6r2/p3p3p/1n7/2P6/P7P/3R5/4A4/4KABc1 w - - 0 1',
          },
          {
            id: 'g:21011901ad1264c34c05980cb92c0ecb',
            title: {
              zh: '\u7b2c\u5341\u5c40 \u8ba9\u65bd\u5609\u8c1f\u5355\u5148\u7b2c\u4e09\u5c40(\u65bd\u80dc)',
              en: 'Game 10: Allowing Shi Jiamo to Take the Third Game \u2014 Shi Wins',
            },
            finalFen: '3ak4/4a4/2n1b1nrc/p2Rp1R1p/6b2/2C2N2P/P1P1P4/1rN1BC3/1c2A4/2B1KA3 b - - 0 1',
          },
          {
            id: 'g:3418a81b76b1253a3de1aee101e0af20',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u8ba9\u9648\u6cf0\u4e30\u5355\u5148\u7b2c\u4e00\u5c40(\u5434\u80dc)',
              en: 'Game 4: Chen Taifeng Given a Single-Move Handicap, First Game \u2014 Wu Wins',
            },
            finalFen: '2bakn3/4aN3/4b4/p7p/4p1P2/9/P1prcR2P/B2C5/1nC1A4/3K1AB2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u8c61\u68cb\u8403\u83c1\u7eed\u7f16\u9009\u7cb9',
          en: 'Yicheng\u2014Selected Excerpts from the Sequel to Xiangqi Essence',
        },
        games: [
          {
            id: 'g:669dda12bb87b8967cbaf6850558efc5',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u6c88\u6587\u8367(\u5148) \u5f20\u9526\u8363(\u80dc)',
              en: 'Game 1: Shen Wenying vs. Zhang Jinrong \u2014 Black Wins',
            },
            finalFen: '2bak4/4a4/3cb3n/p3p3C/7Rp/2p3P2/P1n1P3P/2C6/3K5/1N2r1BR1 w - - 0 1',
          },
          {
            id: 'g:0bb8dd6f7c784f71fa23486c5b86aa10',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u5f20\u89c2\u4e91',
              en: 'Game 7: Zhang Jinrong vs. Zhang Guanyun \u2014 Red Wins',
            },
            finalFen: '4ka3/4a4/9/p1P2rp2/9/P1R6/8P/4B4/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:1a66456387cfcef05e87ad5fa1a847bb',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u5f20\u9526\u8363(\u5148) \u738b\u6d69\u7136(\u80dc)',
              en: 'Game 3: Zhang Jinrong \u2014 Red, Wang Haoran \u2014 Black Wins',
            },
            finalFen: '2baka3/3r5/n2c2n2/N3p3p/6b2/2r6/P3P3P/C3B2C1/9/1R1AKABR1 b - - 0 1',
          },
          {
            id: 'g:857430f2d1fd236acd61ed90183b9d63',
            title: {
              zh: '\u7b2c\u4e5d\u5c40 \u6768\u4e07\u6e90(\u5148) \u4e07\u542f\u6709(\u80dc)',
              en: 'Game 9: Yang Wanyuan \u2014 Red, Wan Qiyou \u2014 Black Wins',
            },
            finalFen: '4kab2/4a4/2n1b2R1/p3p4/9/5nc2/P3P4/C1N4C1/9/3AKA1r1 w - - 0 1',
          },
          {
            id: 'g:1a02378bb66d820016c10be1439483d4',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e00\u5c40 \u7aa6\u56fd\u67f1(\u5148\u80dc) \u5434\u677e\u4ead',
              en: 'Game 21: Dou Guozhu vs. Wu Songting \u2014 Red Wins',
            },
            finalFen: '2bak4/4a4/4b3n/p5p1p/2pP5/2P1r4/P2RNrP1P/R1N6/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:10d2236e5aee77be4da8646755c36395',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e09\u5c40 \u4e07\u542f\u6709(\u5148\u80dc) \u6c88\u6587\u8367',
              en: 'Game 23: Wan Qiyou vs. Shen Wenying \u2014 Red Wins',
            },
            finalFen: '3akabr1/9/4b4/p7p/5Rp2/2p6/P1P1r1P1P/4C4/4A4/R1B1KAB2 b - - 0 1',
          },
          {
            id: 'g:c0f21ed0bb1f5cf364a1446d0c397918',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e94\u5c40 \u7aa6\u56fd\u67f1(\u5148\u80dc) \u9093\u6625\u6797',
              en: 'Game 25: Dou Guozhu \u2014 Red Wins vs. Deng Chunlin',
            },
            finalFen: '6b2/3k5/1R1aba3/4C3p/2p3p2/9/P1P1P2cP/1N2B1n1B/4Ar3/3K1A3 b - - 0 1',
          },
          {
            id: 'g:050250a07b62d4ffe925c8f7af8a7b88',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u56db\u5c40 \u6731\u9526\u5802(\u5148) \u5f20\u9526\u8363(\u80dc)',
              en: 'Game 24: Zhu Jintang vs. Zhang Jinrong \u2014 Black Wins',
            },
            finalFen: 'rnbakabr1/9/1c4nc1/p3p1p1p/2p6/9/P1P1P1P1P/1C2C1N2/9/RNBAKABR1 w - - 0 1',
          },
          {
            id: 'g:510621cbb34faf84c6f4727140f8ea7a',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u5c40 \u7aa6\u56fd\u67f1(\u5148) \u5434\u677e\u4ead(\u80dc)',
              en: 'Game 20: Dou Guozhu vs. Wu Songting \u2014 Black Wins',
            },
            finalFen: '2Ca5/4ak3/4c4/p1p1R4/4c1b2/9/P1P6/N8/4K4/2Br5 w - - 0 1',
          },
          {
            id: 'g:df2a69077f9e3351e8864147977fedcb',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u6797\u5955\u4ed9(\u5148\u80dc) \u6c88\u6587\u8367',
              en: 'Game 2: Lin Yixian Defeats Shen Wenying',
            },
            finalFen: '2bak3r/1r2a4/1c4R1c/p3C1p1p/1np6/5NP2/P3P3P/4B4/9/RN1AKAB2 b - - 0 1',
          },
          {
            id: 'g:2b037a62efb1f1dc69a4d48a09c7013b',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u5f20\u9526\u8363(\u5148\u548c) \u5468\u7115\u6587',
              en: 'Game 5: Zhang Jinrong vs. Zhou Huanwen \u2014 Draw',
            },
            finalFen: '2bk2r2/2N1a4/3abc3/p2R4p/2p6/4P1n2/P1P5P/N8/9/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:756fd7c99ba4d7eaa8aac3148535978a',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u4e01\u5fd7\u9e3f(\u4e8c\u5148) \u4e07\u542f\u6709(\u80dc)',
              en: 'Game 8: Ding Zhihong (Two-Move Handicap) vs. Wan Qiyou \u2014 Black Wins',
            },
            finalFen: '2ba1k2C/4a4/n3c3b/p1pR2p2/9/P1P6/6P1P/4BrN2/4A4/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:9418f38851c646a0f26c1c1ad049bd62',
            title: {
              zh: '\u7b2c\u516d\u5c40 \u5f20\u9526\u8363(\u5148) \u5f20\u89c2\u4e91(\u80dc)',
              en: 'Game 6: Zhang Jinrong vs. Zhang Guanyun',
            },
            finalFen: '4ka3/1c2a4/6r2/pr2p3R/2p6/8N/P3n3P/4B4/3R5/2BAKA3 w - - 0 1',
          },
          {
            id: 'g:6659336021a3dea40ea008a4cdc18bde',
            title: {
              zh: '\u7b2c\u5341\u4e00\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u5468\u5fb7\u88d5',
              en: 'Game 11: Zhang Jinrong vs. Zhou Deyu \u2014 Red Wins',
            },
            finalFen: '2bak1rC1/1r1Ra4/4N1n2/p5R1p/2p1p4/9/P1P2p2P/4B4/4A4/3AK3c b - - 0 1',
          },
          {
            id: 'g:cf930c7a1d9594a0fd19330ade99cb15',
            title: {
              zh: '\u7b2c\u5341\u4e03\u5c40 \u7f57\u5929\u9633(\u5148\u80dc) \u5f20\u9526\u8363',
              en: 'Game 17: Luo Tianyang vs. Zhang Jinrong \u2014 Red Wins',
            },
            finalFen: '4ka3/4a4/4b3n/p3R1p1p/2p3b2/1r4C1P/9/4B4/4A4/C2AK1B2 b - - 0 1',
          },
          {
            id: 'g:f4391cb778dbec6975e09af3c91f9c2e',
            title: {
              zh: '\u7b2c\u5341\u4e5d\u5c40 \u5434\u677e\u4ead(\u5148\u548c) \u5f20\u9526\u8363',
              en: 'Game 19: Wu Songting vs. Zhang Jinrong \u2014 Draw',
            },
            finalFen: '3akab2/N8/4b4/6p1p/2p6/6P2/2n1c3P/2C6/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:2332d14b3a8e0907370c7629e22718e6',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40 \u5f20\u9526\u8363(\u5148) \u5468\u5fb7\u88d5(\u80dc)',
              en: 'Game 12: Zhang Jinrong vs. Zhou Deyu \u2014 Black Wins',
            },
            finalFen: '2ba5/4k4/4ba3/R7p/6n2/P5C2/1r6P/2p1B4/4A1p2/2B1KA3 w - - 0 1',
          },
          {
            id: 'g:68a699d8e578e5b2831187477a8790e0',
            title: {
              zh: '\u7b2c\u5341\u4e94\u5c40 \u7aa6\u56fd\u67f1(\u5148\u80dc) \u7f57\u5929\u9633',
              en: 'Game 15: Dou Guozhu vs. Luo Tianyang \u2014 Red Wins',
            },
            finalFen: '1rba5/2n1akN2/4b4/3n4p/4R4/5C3/3cP1p1P/2N1B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:e62422d57f1fe8f15a139578b7c6e405',
            title: {
              zh: '\u7b2c\u5341\u516b\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u7f57\u5929\u9633',
              en: 'Game 18: Zhang Jinrong \u2014 Red Wins vs. Luo Tianyang',
            },
            finalFen: '4kN3/5R2C/2n2a3/p8/2p6/3r2p2/P1c5P/4B4/4A4/3AK1B2 b - - 0 1',
          },
          {
            id: 'g:5a72ccadc499fe4402837740e331ed11',
            title: {
              zh: '\u7b2c\u5341\u516d\u5c40 \u7aa6\u56fd\u67f1(\u5148) \u9093\u6625\u6797(\u80dc)',
              en: 'Game 16: Dou Guozhu vs. Deng Chunlin \u2014 Black Wins',
            },
            finalFen: '2bc1kbR1/1r2a4/5a3/p3p1NNp/6p2/2B6/P3P3P/9/3KA4/5Ac2 w - - 0 1',
          },
          {
            id: 'g:341549ae8b54d7d388bdc2308f459ee7',
            title: {
              zh: '\u7b2c\u5341\u56db\u5c40 \u5468\u5fb7\u88d5(\u5148\u80dc) \u5f20\u9526\u8363',
              en: 'Game 14: Zhou Deyu vs. Zhang Jinrong \u2014 Red Wins',
            },
            finalFen: 'r3ka1R1/4R4/3ccr3/2p1C3p/p8/2P6/P4pn1P/6N2/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:492f337352c932e9b024b0fce48b7eeb',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u5f20\u9526\u8363(\u5148) \u738b\u6d69\u7136(\u80dc)',
              en: 'Game 4: Zhang Jinrong vs. Wang Haoran \u2014 Black Wins',
            },
            finalFen: '4kab2/4a4/4b4/p1p6/3R5/4P4/P1PNr4/5R3/3K5/3A1nr2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u8c61\u68cb\u8403\u83c1\u9009\u7cb9',
          en: 'Yicheng\u2014Selected Excerpts from Xiangqi Essence',
        },
        games: [
          {
            id: 'g:d26bbbefa5cde265382e57fa489cf0ef',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u6768\u4e07\u6e90(\u5148) \u5f20\u9526\u8363(\u80dc)',
              en: 'Yang Wanyuan vs. Zhang Jinrong \u2014 Black Wins',
            },
            finalFen: '2bak1r2/4a4/2n1b4/p1p1p3p/4r4/4cc3/P1P1R2C1/N2N2p1B/3CA4/R2AK1B2 b - - 0 1',
          },
          {
            id: 'g:bccab34c64d83a90f00b97918e4d149d',
            title: {
              zh: '\u7b2c\u4e03\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u5468\u5fb7\u88d5',
              en: 'Game 7: Zhang Jinrong \u2014 Red Wins vs. Zhou Deyu',
            },
            finalFen: '2Ra1kr2/4R4/9/2pN4p/4P1p2/p1Pr5/4C1P1P/B1n2c3/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:e52dba6241662100414f408b4f6b251c',
            title: {
              zh: '\u7b2c\u4e09\u5c40 \u9093\u6625\u6797(\u5148) \u6797\u5955\u4ed9(\u80dc)',
              en: 'Game 3: Deng Chunlin \u2014 Red, Lin Yixian \u2014 Black Wins',
            },
            finalFen: '2b1kab2/4aR3/2n1c4/p1c5p/9/9/P1R5P/3C3r1/4A1r2/3A1K3 w - - 0 1',
          },
          {
            id: 'g:e1ee862598a9a0f70867df9f320fc00a',
            title: {
              zh: '\u7b2c\u4e5d\u5c40 \u738b\u6d69\u7136(\u5148\u80dc) \u5468\u7115\u6587',
              en: 'Game 9: Wang Haoran vs. Zhou Huanwen \u2014 Red Wins',
            },
            finalFen: '2b1kaP2/3caR3/2nNb4/p4R2p/2p6/9/P1n5P/2r1B4/4A4/3AK1B2 b - - 0 1',
          },
          {
            id: 'g:09ffd1bc24dfd3f6feddc2a59a38a2a7',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e00\u5c40 \u5f20\u9526\u8363(\u5148) \u5468\u5fb7\u88d5(\u80dc)',
              en: 'Game 21: Zhang Jinrong vs. Zhou Deyu \u2014 Black Wins',
            },
            finalFen: '4kab2/4a4/1c2b1n2/4p1R1p/p8/8P/4r1P2/3C4N/4A4/4KA3 w - - 0 1',
          },
          {
            id: 'g:3f250133228e0f3269285f9dafff3fa1',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u4e8c\u5c40 \u5f20\u9526\u8363(\u5148) \u5468\u5fb7\u88d5',
              en: 'Game 22: Zhang Jinrong vs. Zhou Deyu \u2014 Red Wins',
            },
            finalFen: '2b3c2/3k5/3C1r3/p8/6b1p/c1p6/3R4P/4C3N/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:4a365405a0ab605572d5c05dcd700a9b',
            title: {
              zh: '\u7b2c\u4e8c\u5341\u5c40 \u5f20\u9526\u8363(\u5148\u80dc) \u4e07\u542f\u6709',
              en: 'Game 20: Zhang Jinrong vs. Wan Qiyou \u2014 Red Wins',
            },
            finalFen: 'rnbakab1r/9/1c4nc1/p1p1p3p/6p2/2P6/P3P1P1P/1CN4C1/R8/2BAKABNR b - - 0 1',
          },
          {
            id: 'g:945f4f23b917820aeb839c80d2f8187d',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u6768\u4e07\u6e90(\u5148) \u5f20\u9526\u8363(\u80dc)',
              en: 'Game 2: Yang Wanyuan vs. Zhang Jinrong \u2014 Black Wins',
            },
            finalFen: '4kab2/4a4/n1c1b4/p1p1p1C1p/5r1n1/2P5P/Pc2P4/1C2B1N2/R2N5/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:3848f1d9f94076aaa1756cc1ec33a140',
            title: {
              zh: '\u7b2c\u4e94\u5c40 \u6768\u4e07\u6e90(\u5148) \u738b\u6d69\u7136(\u80dc)',
              en: 'Game 5: Yang Wanyuan vs. Wang Haoran \u2014 Red Wins',
            },
            finalFen: '1R1ckab2/4a4/2N1b3n/2p2Rr1p/p8/9/P3P3P/3AB3r/9/4KA3 w - - 0 1',
          },
          {
            id: 'g:3f93e536f6ce8d66c60bdd183cfe3ac7',
            title: {
              zh: '\u7b2c\u516b\u5c40 \u5468\u7115\u6587(\u5148\u80dc) \u738b\u6d69\u7136',
              en: 'Game 8: Zhou Huanwen vs. Wang Haoran \u2014 Red Wins',
            },
            finalFen: '4kabC1/4a4/9/p1N6/8p/2P1r4/P7n/9/4A4/3AKR3 b - - 0 1',
          },
          {
            id: 'g:e53c07ed1050972f90619ab619c71292',
            title: {
              zh: '\u7b2c\u516d\u5c40 \u6c88\u6587\u8367(\u5148) \u738b\u6d69\u7136(\u80dc)',
              en: 'Game 6: Shen Wenying \u2014 Red, Wang Haoran \u2014 Black Wins',
            },
            finalFen: '3aka3/9/9/4p4/8p/R8/4r4/9/4A4/4KA3 w - - 0 1',
          },
          {
            id: 'g:f8fb09f0500ade3f45f29fe8eca086a8',
            title: {
              zh: '\u7b2c\u5341\u4e00\u5c40 \u5f20\u9526\u8363(\u5148) \u4e07\u542f\u6709(\u80dc)',
              en: 'Zhang Jinrong vs. Wan Qiyou \u2014 Red Wins',
            },
            finalFen: '2bak1b2/4a4/9/p3n3p/4c4/6B2/P7P/4B2C1/3KA4/5A3 w - - 0 1',
          },
          {
            id: 'g:ed84c4da6cb19954635fcc226ef521be',
            title: {
              zh: '\u7b2c\u5341\u4e03\u5c40 \u6731\u9526\u5802(\u5148\u80dc) \u7aa6\u56fd\u67f1',
              en: 'Game 17: Zhu Jintang vs. Dou Guozhu \u2014 Red Wins',
            },
            finalFen: '3a1kb2/1r2a1N2/4b3c/p2R4p/1np6/3rp1B2/6PnP/3A1C3/2C6/2RK1AB2 b - - 0 1',
          },
          {
            id: 'g:9a4b502c3443d859435283e7b80a1888',
            title: {
              zh: '\u7b2c\u5341\u4e09\u5c40 \u738b\u6d69\u7136(\u5148\u548c) \u5468\u7115\u6587',
              en: 'Game 13: Wang Haoran vs. Zhou Huanwen \u2014 Draw',
            },
            finalFen: '1rb1kab2/4a4/6r2/p7p/2p1p1p2/9/P1P3P1P/9/8R/R1BAKAB2 w - - 0 1',
          },
          {
            id: 'g:1f48d84158d979e6ff1d2771a4808349',
            title: {
              zh: '\u7b2c\u5341\u4e5d\u5c40 \u4e07\u542f\u6709(\u5148) \u5f20\u9526\u8363(\u80dc)',
              en: 'Game 19: Wan Qiyou vs. Zhang Jinrong \u2014 Black Wins',
            },
            finalFen: 'r2akab2/5C3/2n1b1n2/p4R2p/4c4/2P3P2/P7P/3NB4/2r6/2BAKA1R1 w - - 0 1',
          },
          {
            id: 'g:98e1b9be482edf17045be27e0f15dbb4',
            title: {
              zh: '\u7b2c\u5341\u4e8c\u5c40 \u5468\u7115\u6587(\u5148\u548c) \u738b\u6d69\u7136',
              en: 'Game 12: Zhou Huanwen vs. Wang Haoran \u2014 Draw',
            },
            finalFen: '1r1akab2/6n2/2n6/p3p1N1p/2b6/6P2/P7P/3NB4/4A4/2BAK2R1 b - - 0 1',
          },
          {
            id: 'g:31a48b40af1c0990c0c57b3c02644fec',
            title: {
              zh: '\u7b2c\u5341\u4e94\u5c40 \u738b\u6d69\u7136(\u5148\u548c) \u5468\u7115\u6587',
              en: 'Game 15: Wang Haoran vs. Zhou Huanwen \u2014 Draw',
            },
            finalFen: '1Cbakab2/4c4/3n5/p7p/2p6/9/P1P2r2P/4B1N2/2cN5/1R1AKAB2 w - - 0 1',
          },
          {
            id: 'g:b70f80ddc8411aad6dbd50e058f78c20',
            title: {
              zh: '\u7b2c\u5341\u516b\u5c40 \u5f20\u9526\u8363(\u5148) \u96f7\u6d77\u5c71(\u80dc)',
              en: 'Game 18: Zhang Jinrong vs. Lei Haishan \u2014 Black Wins',
            },
            finalFen: '2b2C3/3k5/4ca3/8p/9/9/P3P1P1P/1C7/3rANr2/1R2KA3 w - - 0 1',
          },
          {
            id: 'g:1b705691994d4a9e4daefe95eb54fd87',
            title: {
              zh: '\u7b2c\u5341\u516d\u5c40 \u5468\u7115\u6587(\u5148\u548c) \u738b\u6d69\u7136',
              en: 'Game 16: Zhou Huanwen vs. Wang Haoran \u2014 Draw',
            },
            finalFen: '3nkab2/4a4/4b4/pc6p/2P3n2/4r1R2/P3N3P/1C2B1N2/4A4/2BAK4 w - - 0 1',
          },
          {
            id: 'g:beef1ead25a08359d81286e2fc4b1f79',
            title: {
              zh: '\u7b2c\u5341\u56db\u5c40 \u5468\u7115\u6587(\u5148\u548c) \u738b\u6d69\u7136',
              en: 'Game 14: Zhou Huanwen vs. Wang Haoran \u2014 Draw',
            },
            finalFen: '2ba1k3/4a4/4b4/p3p3p/1n1P5/6Rc1/5r2P/N2C5/3KA4/2B2AB1c w - - 0 1',
          },
          {
            id: 'g:92e8161aca09b3c55d8ae28e84ad50b5',
            title: {
              zh: '\u7b2c\u5341\u5c40 \u5f20\u9526\u8363(\u5148) \u4e94\u6d69\u7136(\u80dc)',
              en: 'Game 10: Zhang Jinrong vs. Wu Haoran',
            },
            finalFen: '4kab2/8c/4ba3/4c3p/9/N4p2P/9/B2A5/9/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:c53467414163fa56b789a153e599881a',
            title: {
              zh: '\u7b2c\u56db\u5c40 \u6c88\u6587\u8367(\u5148) \u6797\u5955\u4ed9(\u80dc)',
              en: 'Game 4: Shen Wenying vs. Lin Yixian \u2014 Black Wins',
            },
            finalFen: '2ba1k3/4a4/1c2b2c1/8p/p8/1CP1P1R2/Pr6P/N3B4/4K4/2BA5 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\u2500\u2500\u8c61\u68cb\u56fe\u68cb\u65b0\u8c31\u300a\u540d\u624b\u5bf9\u5c40\u300b\u9009\u7cb9',
          en: 'Yicheng\u2014Selected Excerpts from "Master Match" Games',
        },
        games: [
          {
            id: 'g:d2f1e83e39cece062f21ec598b6de165',
            title: {
              zh: '\u7b2c\u4e00\u5c40 \u9547\u6c5f\u738b\u6d69\u7136(\u5148\u80dc) \u6c38\u5609\u6797\u5955\u4ed9',
              en: 'Game 1: Wang Haoran of Zhenjiang vs. Lin Yixian of Yongjia \u2014 Red Wins',
            },
            finalFen: '2bak4/3r5/C4a2r/p1p5p/6p2/2P6/P3P1c1P/6N2/R8/2BAKABR1 b - - 0 1',
          },
          {
            id: 'g:dacb139c5d69c12d07fa6b4c06485b18',
            title: {
              zh: '\u7b2c\u4e8c\u5c40 \u6c38\u5609\u6797\u5955\u4ed9(\u5148\u80dc) \u9547\u6c5f\u738b\u6d69\u7136',
              en: 'Game 2: Lin Yixian of Yongjia Defeats Wang Haoran of Zhenjiang',
            },
            finalFen: '1rbakn1r1/4a4/2n1b4/p5p1p/2p1CN3/1c7/P1P3P1P/4C3R/R8/2BAKAB2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5955\u4e58\uff0d\uff0d\u8c61\u68cb\u6bd4\u8d5b\u53c2\u89c2\u8bb0',
          en: 'Yicheng\u2014A Record of Watching a Xiangqi Competition',
        },
        games: [
          {
            id: 'g:af1bad3ce26d54ee84b85e2e87e46cfc',
            title: {
              zh: '\u7b2c\u4e00\u5c40\u6c5f\u90fd\u5468\u5fb7\u88d5\u5148\u80dc\u9ec4\u5188\u7f57\u5929\u626c',
              en: 'Game 1: Zhou Deyu of Jiangdu Defeats Luo Tianyang of Huanggang',
            },
            finalFen: '3akab2/2r6/2n1b4/p1R5p/6pN1/9/P1p1N1P1P/9/9/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:7b9dae59209aafd876511e76464985fa',
            title: {
              zh: '\u7b2c\u4e8c\u5c40\u9ec4\u5188\u7f57\u5929\u626c\u5148\u80dc\u6c5f\u90fd\u5468\u5fb7\u88d5',
              en: 'Game 2: Luo Tianyang of Huanggang Defeats Zhou Deyu of Jiangdu',
            },
            finalFen: 'r2akab2/9/3cb1n2/p3p3p/6P2/9/P7P/C3CN3/8R/3AKAB2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'wushimeihuapu',
    title: {
      zh: '\u5434\u6c0f\u6885\u82b1\u8c31',
      en: "Wu's Plum Flower Manual",
    },
    chapters: [
      {
        title: {
          zh: '\u5434\u6c0f\u6885\u82b1\u8c31',
          en: "Wu's Plum Flower Manual",
        },
        games: [
          {
            id: 'g:30cdd0bfc5f09499f608edc705b5ebd9',
            title: {
              zh: '\u8ba9\u5148\u5c4f\u98ce\u9a6c\u7834\u58eb\u89d2\u70ae\u5939\u9a6c\u70ae\u5c40 \u5c40\u4e09',
              en: 'Handicap Screen Horse Defense Breaks the Advisor\u2019s Corner Cannon with Horse and Cannon, Game 3',
            },
            finalFen: '3akab2/6R2/4b4/p3p3p/2p6/9/P3P1P1P/N1c2A3/c2K2r2/1r3A2C w - - 0 1',
          },
          {
            id: 'g:0c54b08612428b8693c2a906e5f5f26d',
            title: {
              zh: '\u8ba9\u5148\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u6a2a\u8f66\u5c40 \u5c40\u4e8c',
              en: 'Even Odds \u2014 Screen Horse Defense Breaks the Central Cannon, Ranked Chariot Formation, Game 2',
            },
            finalFen: '1r1ak4/4a4/2C1b4/p3p3p/9/2P1P4/P3c1N1P/4B3B/4A4/R2AKrpR1 w - - 0 1',
          },
          {
            id: 'g:aff9f3651273ebffd6c58ee8084c6729',
            title: {
              zh: '\u8ba9\u5148\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u5939\u9a6c\u5c40\u3000\u5c40\u56db',
              en: 'Letting Red Take the First Move: Screen Horse Defense Breaks the Central Cannon with Flanking Horses, Game Four',
            },
            finalFen: '3k1a3/4a4/2R6/p7p/6p2/2B3P2/P3c3P/4n4/5K2N/5rB2 w - - 0 1',
          },
          {
            id: 'g:ddc13b49d24fc90937894707e679e4cf',
            title: {
              zh: '\u8ba9\u5148\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u76f4\u8f66\u5c40\u3000\u5c40\u4e00',
              en: 'Handicap Screen Horse Defense Breaks the Filed Chariot Opening, Game 1',
            },
            finalFen: '3akab2/9/2C1b4/p3p3p/1R7/2Pn2B2/P3P3P/N6r1/4K1c2/2BA4c w - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'wushuangpinmeihuapu',
    title: {
      zh: '\u65e0\u53cc\u54c1\u6885\u82b1\u8c31',
      en: 'Unparalleled Plum Flower Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u65e0\u53cc\u54c1\u6885\u82b1\u8c31',
          en: 'Unparalleled Plum Flower Manual',
        },
        games: [
          {
            id: 'g:f071206c4d7b8cb46e03a407362fde40',
            title: {
              zh: '\u7b2c\u4e00\u5c40\uff1a\u7834\u5f53\u5934\u70ae\u53ca\u8fc7\u6cb3\u8f66\u53bb\u5352\u540e\u9000\u4e00\u7740\u6cd5',
              en: 'Game 1: A Method of Breaking the Central Cannon and River-Crossing Chariot by Retreating the Pawn One Move',
            },
            finalFen: '2bakab2/4n4/9/p3p3p/5P3/9/P1P1P3P/2C1B1N2/1C2Ar1c1/RN1AK3c w - - 0 1',
          },
          {
            id: 'g:768a712abefb928d5a6d21a871fe5928',
            title: {
              zh: '\u7b2c\u4e09\u5c40\uff1a\u7834\u5f53\u5934\u70ae\u53ca\u8fc7\u6cb3\u8f66\u53bb\u5352\u540e\u9000\u4e8c\u7740\u6cd5',
              en: 'Game 3: Break the Central Cannon and the River-Crossing Chariot, Then Retreat the Pawn in Two Moves',
            },
            finalFen: '2bakab2/r5c2/6c2/p3p3p/2p6/5R3/P1P1P3P/1C1CB4/4An1r1/RN1AKNB2 w - - 0 1',
          },
          {
            id: 'g:e3abb76f42e06820231890a3f2c762b2',
            title: {
              zh: '\u7b2c\u4e8c\u5c40\uff1a\u7834\u5f53\u5934\u70ae\u53ca\u8fc7\u6cb3\u8f66\u53bb\u5352\u540e\u5e73\u4e8c\u7740\u6cd5',
              en: 'Game 2: Break the Central Cannon and, After the River Crossing Chariot Captures the Pawn, Play the Second-Move Line',
            },
            finalFen: 'r2akabr1/2c6/1c2b1n2/p3p2Rp/3n5/2P3P2/P3P3P/3CC1N2/9/RNBAKAB2 w - - 0 1',
          },
          {
            id: 'g:e9700b73109f1c0570439b4198f4d9d2',
            title: {
              zh: '\u7b2c\u56db\u5c40\uff1a\u7834\u5f53\u5934\u70ae\u53ca\u8fc7\u6cb3\u8f66\u53bb\u5352\u540e\u5e73\u4e8c',
              en: 'Game 4: Break the Central Cannon and River-Crossing Chariot, Then Equalize at Two',
            },
            finalFen: '2ba1ab2/4k4/9/p2R4p/9/9/P1P1P1P1P/3A1r3/1cn1N4/1NBK1AB2 w - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'shilinguangji',
    title: {
      zh: '\u4e8b\u6797\u5e7f\u8bb0',
      en: 'Encyclopedia of Everything',
    },
    chapters: [
      {
        title: {
          zh: '\u4e8b\u6797\u5e7f\u8bb0',
          en: 'Expanded Records of Affairs',
        },
        games: [
          {
            id: 'g:624b3bfb86f47a45ec526f7feed67716',
            title: {
              zh: '\u9976\u5148\u5217\u624b\u53d6\u80dc\u5c40',
              en: 'Handicap Opposite Direction Cannons, Winning Line',
            },
            finalFen: '3akab1r/6r2/4b1n2/p1p1n1p1p/9/4C4/P1P3P1P/2N1C4/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:7f0ff0e3c27fe2eee2c8c87e9fedddac',
            title: {
              zh: '\u9976\u5148\u987a\u624b\u53d6\u80dc\u5c40',
              en: 'First-Move Handicap: Same Direction Cannons Win',
            },
            finalFen: 'r1baka2r/9/1c2c1n1b/p3p3p/3R5/6P2/P1P1P3P/1C2C1N2/2n6/RNBAKAB2 w - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'shanqingtang',
    title: {
      zh: '\u5584\u5e86\u5802\u91cd\u8ba2\u6885\u82b1\u53d8',
      en: 'Shan Qing Tang Revised Plum Flower Variations',
    },
    chapters: [
      {
        title: {
          zh: '\u5f97\u5148',
          en: 'Red to Move',
        },
        games: [
          {
            id: 'g:71b9cfefe3e836a2687de0800a301e06',
            title: {
              zh: '\u7b2c1\u5c40\u5f53\u5934\u70ae\u76f4\u8f66\u7834\u5c4f\u98ce\u9a6c',
              en: 'Game 1: Central Cannon and Filed Chariot Break Screen Horse Defense',
            },
            finalFen: 'r3kabn1/4a4/4b3c/p5R1p/2p1CNp2/9/P1c3P1P/4C4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:ad10e7ea02dfdc0233344ac06eee038b',
            title: {
              zh: '\u7b2c2\u5c40\u5f53\u5934\u70ae\u6a2a\u8f66\u7834\u5c4f\u98ce\u9a6c',
              en: 'Game 2: Central Cannon, Ranked Chariot Breaks Screen Horse',
            },
            finalFen: '2Rakab2/7r1/3Nb4/p7p/2p3p2/5n3/P1P3P1P/3C5/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:954b960478c0ab515ca9eff26c981702',
            title: {
              zh: '\u7b2c3\u5c40\u5f53\u5934\u70ae\u7834\u5c4f\u98ce\u9a6c\u76f4\u8f66',
              en: 'Game 3: Central Cannon Breaks the Screen Horse Defense and Filed Chariot',
            },
            finalFen: '1r1akab2/5R3/4b1n2/p2Np3p/6p2/9/P1P3P1P/B3C4/4A4/3K1AB2 b - - 0 1',
          },
          {
            id: 'g:6f0c4f611e6580327a4d1f1010d2b91d',
            title: {
              zh: '\u7b2c4\u5c40\u5f53\u5934\u70ae\u6a2a\u8f66\u7834\u5c4f\u98ce\u9a6c\u8fdb\u70ae',
              en: 'Game 4: Central Cannon, Ranked Chariot Breaks Screen Horse, Advancing Cannon',
            },
            finalFen: '1n2ka3/9/4Ca3/p3C1p1p/2p1p2r1/6P2/P1P5P/9/3R5/2BAKABc1 b - - 0 1',
          },
          {
            id: 'g:12e023e9befa8f02df3031240b6a3fa0',
            title: {
              zh: '\u7b2c5\u5c40\u5f53\u5934\u70ae\u76f4\u8f66\u7834\u5c4f\u98ce\u9a6c\u6162\u58eb',
              en: 'Game 5: Filed Chariot Breaks Screen Horse Defense and Stalls the Advisors',
            },
            finalFen: 'R2n2bn1/3R5/2C1bk1c1/8p/2p3p2/9/Pr4P1P/4B4/4A4/4KAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5148',
          en: 'Black Gives the First Move',
        },
        games: [
          {
            id: 'g:f2ddef2ff3f6a4cd0bb5a872f65cf0d3',
            title: {
              zh: '\u7b2c1\u5c40\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u6a2a\u8f66',
              en: 'Game 1: Screen Horse Defense Broken by Central Cannon and Ranked Chariot',
            },
            finalFen: '2bak4/4a4/4b1n2/p5p1p/2PNp4/9/P2r4P/2C1n1N2/3RA4/R1BK1Acc1 w - - 0 1',
          },
          {
            id: 'g:67dca72e4e16a1b860592250ed599249',
            title: {
              zh: '\u7b2c2\u5c40\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u6d3b\u6349\u8f66',
              en: 'Game 2: Screen Horse Defense Breaks Central Cannon, Capturing the Chariot',
            },
            finalFen: 'r3kab2/4a4/4b1n2/p7p/4R2r1/6P2/P1P1P3P/NC4N2/9/R1BAKA2c w - - 0 1',
          },
          {
            id: 'g:f834a430e703781f25e2fc909527d70f',
            title: {
              zh: '\u7b2c3\u5c40\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u6349\u8f66',
              en: 'Game 3: Screen Horse Defense Breaks the Central Cannon and Wins a Chariot',
            },
            finalFen: '1rb1kabr1/4a4/9/p6cR/2p6/3n5/P1P3P1P/C1N1Bpc2/4A4/2R1K1B2 w - - 0 1',
          },
          {
            id: 'g:e9cd80bb1f019533d34717fe249cf37b',
            title: {
              zh: '\u7b2c4\u5c40\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u76f4\u6a2a\u8f66',
              en: 'Game 4: Screen Horse Defense Breaks a Central Cannon with a Filed Chariot',
            },
            finalFen: '1r2kabr1/4a1c2/3cb1n2/p1R1p1R1p/3n5/2p3P2/P1P1P3P/N1C1C1N2/9/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:8549974f7e277d8b187edd4d5de9ab2b',
            title: {
              zh: '\u7b2c5\u5c40\u5c4f\u98ce\u9a6c\u7834\u5de1\u6cb3\u8f66',
              en: 'Game 5: Screen Horse Defense Against the Riverbank Chariot',
            },
            finalFen: '3akabc1/4n4/4bR3/p1r1C3p/4P4/9/P3C1P1P/5Kc2/3NA2r1/3A2B2 w - - 0 1',
          },
          {
            id: 'g:e9888141d5b1d65028835f0a72ec0c1e',
            title: {
              zh: '\u7b2c6\u5c40\u5c4f\u98ce\u9a6c\u7834\u8fc7\u6cb3\u70ae\u6253\u5352',
              en: 'Game 6: Screen Horse Defense Breaks the River-Crossing Cannon to Attack the Pawn',
            },
            finalFen: '3akab2/9/2c1b1n2/4p1C1p/1n7/2r6/4P2RP/N3CA2B/9/2BAK4 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u6742\u5c40',
          en: 'Miscellaneous Games',
        },
        games: [
          {
            id: 'g:cea59fbbe7f1e434f4387c7008e9b24e',
            title: {
              zh: '\u7b2c1\u5c40\u5355\u63d0\u9a6c\u7834\u5c4f\u98ce\u9a6c',
              en: 'Game 1: Single Horse Defense Breaks Screen Horse Defense',
            },
            finalFen: '2bakab2/9/n8/C3p3p/2P3p2/3n5/P1c1P3P/1RN1B1N2/2c1A4/3AK1Br1 w - - 0 1',
          },
          {
            id: 'g:262ed1c4abe4a5e17d57ad86072ee870',
            title: {
              zh: '\u7b2c2\u5c40\u7834\u58eb\u76f8\u8fdb\u5175\u5c40',
              en: 'Game 2: Break the Elephant and Pawn Opening',
            },
            finalFen: '2bak1b2/4a3N/2n6/p1p3p2/4p2n1/1R2c1P2/P1P2r2P/C1N1B4/4A4/2BAK4 w - - 0 1',
          },
          {
            id: 'g:36542bad8adcdf2787eb46214ddc0e58',
            title: {
              zh: '\u7b2c3\u5c40\u7834\u8fdb\u5175\u5c40',
              en: 'Game 3: Breaking the Pawn-Advance Formation',
            },
            finalFen: '2bakab2/9/2n3c1n/p1p1p4/9/9/P1P1c3P/NC2C4/1R2A2rN/2BAKR1r1 w - - 0 1',
          },
          {
            id: 'g:88e8bc6be01c77a3b3d89669f32ecf25',
            title: {
              zh: '\u7b2c4\u5c40\u7834\u8fc7\u5bab\u70ae\u5c40',
              en: 'Game 4: Break the Cross-Palace Cannon Opening',
            },
            finalFen: '2b1kab2/4a4/4c1R2/p1p5p/9/4c1P2/P1P5P/3rC1N2/4A4/1N2KAB2 w - - 0 1',
          },
          {
            id: 'g:bd347c4232f3e8a6e5bfc09661fee3f8',
            title: {
              zh: '\u7b2c5\u5c40\u8ba9\u53f3\u70ae\u987a\u624b\u5f53\u5934\u70ae',
              en: 'Game 5: Right Cannon Against Same Direction Cannons and Central Cannon',
            },
            finalFen: '1CRak3r/4a4/3c4b/p3n1R1p/2p3p2/9/4r1P1P/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:92218138aee875a4985a7b1aac3af090',
            title: {
              zh: '\u7b2c6\u5c40\u8ba9\u53f3\u70ae\u987a\u624b\u58eb\u89d2\u70ae',
              en: 'Game 6: Right Cannon in a Same Direction Cannons Palcorner Cannon Setup',
            },
            finalFen: 'r1bak3r/2c1a4/nR1cb4/p3C1p1p/9/2R6/P1p1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'meihuaquan',
    title: {
      zh: '\u6885\u82b1\u6cc9',
      en: 'Plum Flower Springs Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u4e0a\u5377',
          en: 'Volume I',
        },
        games: [
          {
            id: 'g:4674ff77c79df2306735ae0846c9030c',
            title: {
              zh: '\u7b2c01\u5c40\u5f53\u5934\u70ae\u6a2a\u8f66\u9e33\u9e2f\u9a6c',
              en: 'Game 1: Central Cannon, Ranked Chariot, Tandem Horses',
            },
            finalFen: '4kab2/4a4/6n2/C7p/6b2/9/P1n1N3P/9/9/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:63f4f1d5d9644470f2defc807bd558a3',
            title: {
              zh: '\u7b2c02\u5c40\u5f53\u5934\u70ae\u53f3\u6a2a\u5de6\u76f4\u8f66',
              en: 'Game 2: Central Cannon, Right Ranked Chariot, Left Filed Chariot',
            },
            finalFen: '4kab2/4a4/9/p6PC/2n3b2/P2pp4/8P/B8/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:8f83d770a72575db8b8d8ec9565e21fb',
            title: {
              zh: '\u7b2c03\u5c40\u5f53\u5934\u70ae\u6a2a\u8f66\u9e33\u9e2f\u9a6c',
              en: 'Game 03: Central Cannon, Ranked Chariot, and Tandem Horses',
            },
            finalFen: '4kab2/4a4/4b4/8p/4N4/9/2p4cP/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:5ad6b5a73cd5ce088b6a19660afd8d71',
            title: {
              zh: '\u7b2c04\u5c40\u5939\u9a6c\u70ae\u6a2a\u8f66\u9e33\u9e2f\u9a6c',
              en: 'Game 4: Horse-Mounted Cannon, Ranked Chariot, Tandem Horses',
            },
            finalFen: '2b1ka3/9/4b4/8R/2p5p/P8/4r4/4B4/4A4/3AK4 b - - 0 1',
          },
          {
            id: 'g:a6934b3934ae2e8110c4b316938b7737',
            title: {
              zh: '\u7b2c05\u5c40\u5c4f\u98ce\u9a6c\u76f4\u8f66\u5f03\u5352\u4e89\u5148',
              en: 'Game 05: Screen Horse Defense, Filed Chariot, Sacrificed Pawn, Fight for the Initiative',
            },
            finalFen: '3akab2/9/4b3n/R8/9/9/8c/4BK3/9/3A1A3 w - - 0 1',
          },
          {
            id: 'g:857976586d41d606c0e4892af87c267b',
            title: {
              zh: '\u7b2c06\u5c40\u5c4f\u98ce\u9a6c\u76f4\u8f66\u4e0e\u5939\u9a6c\u70ae',
              en: 'Game 06: Screen Horse Defense, Double Riverbank Cannons, Filed Chariot',
            },
            finalFen: '3akab2/9/4b4/3R5/2p6/8r/9/4B4/9/R1B1K4 w - - 0 1',
          },
          {
            id: 'g:64fd908996306063ac2a4371c02f9e24',
            title: {
              zh: '\u7b2c07\u5c40\u5c4f\u98ce\u9a6c\u53f3\u5de1\u6cb3\u70ae\u6a2a\u8f66',
              en: 'Game 07: Screen Horse Defense, Right Riverbank Cannon, Ranked Chariot',
            },
            finalFen: '4kab2/2Nca4/4b4/p7p/4R1p2/9/Pr6P/4B4/3rA4/2R1KAB2 b - - 0 1',
          },
          {
            id: 'g:7befdf565e7f0c6054abcf325665bba6',
            title: {
              zh: '\u7b2c08\u5c40\u5c4f\u98ce\u9a6c\u53cc\u5de1\u6cb3\u70ae\u76f4\u8f66',
              en: 'Game 08: Screen Horse Defense, Double Riverbank Cannons, Filed Chariot',
            },
            finalFen: '3akab2/9/4b4/p3r3p/9/6P2/9/4B4/4A4/1RB1KA3 w - - 0 1',
          },
          {
            id: 'g:8fed72239afa41a4349c4d617e411d93',
            title: {
              zh: '\u7b2c09\u5c40\u5355\u63d0\u9a6c\u70ae\u4e8c\u5e73\u4e09',
              en: 'Game 9: Single Horse Defense, C2=3',
            },
            finalFen: '3aka3/9/4b4/p3r4/4R4/n1N6/9/9/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:744f7cb5bf284317482eecf78d26161b',
            title: {
              zh: '\u7b2c10\u5c40\u5c4f\u98ce\u9a6c\u6a2a\u8f66\u5de6\u70ae\u5de1\u6cb3',
              en: 'Game 10: Screen Horse Defense, Ranked Chariot, Left Cannon Patrols the River',
            },
            finalFen: '1rb1ka3/4a4/4b4/p8/9/6p2/P2R5/8C/1n2A4/2B1KA3 b - - 0 1',
          },
          {
            id: 'g:190b38a0ebde6f19273dbf1d193aa159',
            title: {
              zh: '\u7b2c11\u5c40\u5c4f\u98ce\u9a6c\u76f4\u8f66\u53f3\u70ae\u5de1\u6cb3',
              en: 'Game 11: Screen Horse Defense, Filed Chariot, Right Cannon Patrols the River',
            },
            finalFen: '3aka3/9/4b4/1R6p/2b6/P3r3P/6P2/9/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:ff9d771e5fb2c6a9598cfe6db2d7d85d',
            title: {
              zh: '\u7b2c12\u5c40\u5355\u63d0\u9a6c\u5f53\u5934\u70ae\u5316\u7a9d\u5fc3',
              en: 'Game 12: Single Horse Defense, Central Cannon Transforms into a Heart Cannon',
            },
            finalFen: '1n1a1kb2/1C2a4/9/p7p/2p1N1b2/9/P1P3P1P/4B4/4A4/3AK3c w - - 0 1',
          },
          {
            id: 'g:ee0eb77b14b8577c507503171ca51a40',
            title: {
              zh: '\u7b2c13\u5c40\u5939\u5352\u70ae\u5de6\u76f4\u8f66\u53f3\u6a2a\u8f66',
              en: 'Game 13: Pincer-Pawn Cannon, Left Filed Chariot, Right Ranked Chariot',
            },
            finalFen: '3ak4/4a4/8b/p8/9/2P6/P3P4/2r6/4R4/2BAKAB2 w - - 0 1',
          },
          {
            id: 'g:4de547defd770a6fbe4e46c9fbd4396d',
            title: {
              zh: '\u7b2c14\u5c40\u5c4f\u98ce\u9a6c\u76f4\u8f66\u8fdb\u4e09\u4f4d\u5352',
              en: 'Game 14: Screen Horse Defense, Filed Chariot Advances to the Third-Rank Pawn',
            },
            finalFen: '4kab2/4a4/4b4/p7p/1r2NR3/P2n3N1/4p3P/3C1K3/2c1A4/1p1A2c2 w - - 0 1',
          },
          {
            id: 'g:658af6944bbc4957b111d73c6b5d2341',
            title: {
              zh: '\u7b2c15\u5c40\u5c4f\u98ce\u9a6c\u53d8\u8fb9\u9a6c\u76f4\u8f66',
              en: 'Game 15: Screen Horse Defense Transforms into Side Horse and Filed Chariot',
            },
            finalFen: '4kab2/4a4/2n1b4/p7p/2p1c4/9/P1P3r1P/4C4/3rA2R1/R1BNK4 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u4e0b\u5377',
          en: 'Volume III',
        },
        games: [
          {
            id: 'g:6a73829d32577890b2d2f0395ac07cd8',
            title: {
              zh: '\u7b2c01\u5c40\u9976\u53cc\u5148\u987a\u624b\u70ae\u5410\u58eb\u89d2\u76f4\u8f66',
              en: 'Game 1: Two-Move Handicap \u2014 Same Direction Cannons, Palcorner Cannon, and Filed Chariot',
            },
            finalFen: '2ba1k3/4a4/3Cb4/p7p/2p6/6P2/P1PR4P/3KB4/4r1n1c/R1B6 w - - 0 1',
          },
          {
            id: 'g:fd095f169c27fe064e0d413152b5a323',
            title: {
              zh: '\u7b2c02\u5c40\u9976\u53cc\u5148\u987a\u624b\u70ae\u76f4\u8f66\u5de1\u6cb3',
              en: 'Game 2: Two-Move Handicap \u2014 Same Direction Cannons, Filed Chariot, and Riverbank Chariot',
            },
            finalFen: '2bak4/4a4/3cb4/N3N3p/2p6/n8/2P1P3P/4B4/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:79a855f81a9543ad60ed547e45055aa8',
            title: {
              zh: '\u7b2c03\u5c40\u9976\u53f3\u70ae\u5e94\u70ae\u76f4\u8f66\u7834\u5f53\u5934\u70ae',
              en: 'Game 3: Right-Cannon Handicap \u2014 Filed Chariot Defeats Central Cannon',
            },
            finalFen: '2b1Ra3/9/nc1k1rn1b/4p3p/3N5/6p2/2P5P/3CB4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:9bae4b3ee03785a2d679e72abf5d8b71',
            title: {
              zh: '\u7b2c04\u5c40\u9976\u5de6\u9a6c\u5f53\u5934\u70ae\u6a2a\u8f66\u76d8\u5934\u9a6c',
              en: 'Game 4: Left-Horse Handicap \u2014 Central Cannon, Ranked Chariot, and Central Horse',
            },
            finalFen: '4kab2/3Rac2r/2n1bN2n/p5p1p/9/1c2C4/P5P1P/4C4/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:501ea0b4544618d94f01312f141aa7c5',
            title: {
              zh: '\u7b2c05\u5c40\u9976\u5de6\u9a6c\u987a\u624b\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66',
              en: 'Game 5: Left-Horse Handicap \u2014 Same Direction Cannons, Ranked Chariot Defeats Filed Chariot',
            },
            finalFen: '1r1cka1cC/7R1/b8/p5R1p/2p6/9/P1P1r3P/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:4a8add95d5f110fa778553c35af3e3ff',
            title: {
              zh: '\u7b2c06\u5c40\u9976\u5de6\u9a6c\u987a\u624b\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66',
              en: 'Game 6: Left-Horse Handicap \u2014 Same Direction Cannons, Filed Chariot Defeats Ranked Chariot',
            },
            finalFen: '2Rcka3/4a4/2NcR4/6r2/9/6P2/1p2P3P/4B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:b9de994d218116d037a0a9635d39b1d2',
            title: {
              zh: '\u7b2c07\u5c40\u9976\u5de6\u9a6c\u987a\u624b\u70ae\u6a2a\u8f66\u7834\u5148\u80cc\u8865',
              en: 'Game 7: Left-Horse Handicap \u2014 Same Direction Cannons and Ranked Chariot',
            },
            finalFen: 'C8/4k4/r1NR1n3/p5p1p/9/9/P3P3P/9/4A4/2BAK1c2 b - - 0 1',
          },
          {
            id: 'g:21e7428ec920928e30ed1845c8949309',
            title: {
              zh: '\u7b2c08\u5c40\u9976\u5de6\u9a6c\u5217\u624b\u70ae\u76f4\u8f66\u70ae\u538b\u9a6c',
              en: 'Game 8: Left-Horse Handicap \u2014 Opposite Direction Cannons, Filed Chariot, and Cannon Pinning the Horse',
            },
            finalFen: 'C1bak3r/CR2a2R1/4bc2n/p5p2/2p5p/9/P1P1r1P1P/9/4A4/2BAK1B2 b - - 0 1',
          },
          {
            id: 'g:386fd4ec2f03347e91c2831f869682c4',
            title: {
              zh: '\u7b2c09\u5c40\u9976\u5de6\u9a6c\u4e00\u5148\u5f53\u5934\u70ae\u6a2a\u8f66',
              en: 'Game 9: Left-Horse and One-Move Handicap \u2014 Central Cannon and Ranked Chariot',
            },
            finalFen: '3ak1b2/6c2/3ab4/p1pN4p/9/1NPR2R2/P7P/4Bn3/4K2r1/2BA1A3 w - - 0 1',
          },
          {
            id: 'g:3d8dbe745665aa16941710f9219cb1c5',
            title: {
              zh: '\u7b2c10\u5c40\u9976\u5de6\u9a6c\u4e00\u5148\u5355\u63d0\u9a6c\u53d8\u987a\u624b\u70ae',
              en: 'Game 10: Left-Horse and One-Move Handicap \u2014 Single Horse Defense Transposes into Same Direction Cannons',
            },
            finalFen: '2bk1ab2/4a4/9/p1p3p1C/9/9/P1P3P1P/4r4/c2rCK2N/2B2A1R1 w - - 0 1',
          },
          {
            id: 'g:2fd017f94e83e197c036e223a9952324',
            title: {
              zh: '\u7b2c11\u5c40\u9976\u53f3\u9a6c\u4e00\u5148\u987a\u624b\u70ae\u6a2a\u8f66',
              en: 'Game 11: Right-Horse and One-Move Handicap \u2014 Same Direction Cannons and Ranked Chariot',
            },
            finalFen: '1rbakab2/9/9/p1p3pRp/9/2P1n4/P1c3P1P/4B4/4N4/RcCAKAB2 w - - 0 1',
          },
          {
            id: 'g:00e7f480c78b088abb626b073dca1f12',
            title: {
              zh: '\u7b2c12\u5c40\u9976\u53cc\u9a6c\u5e94\u5f53\u5934\u5352\u4e0d\u6253\u51fa\u6797\u8f66',
              en: 'Game 12: Two-Horse Handicap \u2014 Meeting the Central Pawn Without Capturing, Then Developing the Chariot',
            },
            finalFen: 'r1bckrb1C/4R3n/n3c4/p1p1C1p1p/9/9/P1P1P1P1P/9/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:d5484f943060fba880ee8973f549ad7e',
            title: {
              zh: '\u7b2c13\u5c40\u9976\u53cc\u9a6c\u540c\u4e0a\u4f8b\u53cc\u76f4\u8f66',
              en: 'Game 13: Two-Horse Handicap \u2014 Two Filed Chariots, as in the Previous Game',
            },
            finalFen: 'rcbCkn3/3Ra2r1/n3bc3/2p1C1PRp/p8/9/P1P1P3P/9/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:04441d54c67dad0aba39d59028cd965d',
            title: {
              zh: '\u7b2c14\u5c40\u9976\u53cc\u9a6c\u5e94\u5f53\u5934\u5352\u4e0d\u6253\u51fa\u6797\u8f66',
              en: 'Game 14: Two-Horse Handicap \u2014 Meeting the Central Pawn Without Capturing, Then Developing the Chariot',
            },
            finalFen: '1rbRk1r2/4a4/1c2bc3/p1p1C4/6p2/9/P1PnP1P1P/3C5/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:911d5af8742f1ac6d2dfa715863abaf3',
            title: {
              zh: '\u7b2c15\u5c40\u9976\u53cc\u9a6c\u5de1\u6cb3\u70ae\u7834\u6597\u5de1\u6cb3\u70ae',
              en: 'Game 15: Handicap with Two Horses, Riverbank Cannon Breaking the Duelling Riverbank Cannons',
            },
            finalFen: 'r3k3C/2R1aR3/8b/p1p1r3p/6p1c/6P2/P1P1P3P/9/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:188089fdd438086f2ff58a921728489e',
            title: {
              zh: '\u7b2c16\u5c40\u9976\u53cc\u9a6c\u53f3\u70ae\u5de1\u6cb3\u5de6\u70ae\u5f53\u5934',
              en: 'Game 16: Two-Horse Handicap \u2014 Right Riverbank Cannon and Left Central Cannon',
            },
            finalFen: '2b5R/4ak3/n3b2Rc/p1p1C1p1p/1r7/9/P1c1P3P/9/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:72957ccbd80493c9a85b4d97cbef7ed5',
            title: {
              zh: '\u7b2c17\u5c40\u9976\u53cc\u9a6c\u53f3\u70ae\u5de1\u6cb3\u7834\u5217\u624b\u70ae',
              en: 'Game 17: Two-Horse Handicap \u2014 Right Riverbank Cannon Defeats Opposite Direction Cannons',
            },
            finalFen: '2b1kab2/3Ra4/nrc1c3n/p1p1C2rp/6p2/6C2/P1P1P1P1P/3R5/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:cb111e731806986d184cf9071b035171',
            title: {
              zh: '\u7b2c18\u5c40\u9976\u5de6\u8f66\u987a\u624b\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66',
              en: 'Game 18: Left-Chariot Handicap \u2014 Same Direction Cannons, Filed Chariot Defeats Ranked Chariot',
            },
            finalFen: '3N2b2/C3a1R2/n2a1kn2/p4cr1p/9/5rB2/P3P3P/7C1/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:ba7657d0ed59e55a220f43eaee41e935',
            title: {
              zh: '\u7b2c19\u5c40\u9976\u5de6\u8f66\u5f53\u5934\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66',
              en: 'Game 19: Left-Chariot Handicap \u2014 Central Cannon, Ranked Chariot Defeats Filed Chariot',
            },
            finalFen: '4kab2/4a4/n2Nb4/p8/2p3p2/7r1/P1PC5/4CN3/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:5caaf2bd4f6f11954f258c6db0d04ad4',
            title: {
              zh: '\u7b2c20\u5c40\u9976\u5de6\u8f66\u5f53\u5934\u70ae\u6a2a\u8f66\u8fdb\u4e2d\u5175',
              en: 'Game 20: Left-Chariot Handicap \u2014 Central Cannon and Ranked Chariot Advance the Central Pawn',
            },
            finalFen: 'r1ba1k3/9/nc1rbcn2/p4Cp1p/2p6/9/P1P3P1P/4C4/4A4/1NBAK1B2 b - - 0 1',
          },
          {
            id: 'g:18b99d0947e7afa8660e2f4efae2ae51',
            title: {
              zh: '\u7b2c21\u5c40\u9976\u5de6\u8f66\u76f4\u8f66\u9a91\u6cb3\u5316\u7a9d\u5fc3\u70ae',
              en: 'Game 21: Left-Chariot Handicap \u2014 Filed Chariot on the Riverbank Transposes into a Smothered Cannon',
            },
            finalFen: 'r1b1ka3/3Ra4/n1c1C3r/2p5C/p3p1p2/2P6/P3P3P/4B4/4A4/4KAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u4e2d\u5377',
          en: 'Volume II',
        },
        games: [
          {
            id: 'g:d09298595f55ef201b174c857ee565f9',
            title: {
              zh: '\u7b2c01\u5c40\u5939\u9a6c\u70ae\u6a2a\u8f66\u9e33\u9e2f\u9a6c',
              en: 'Game 1: Pincer-Horse Cannon, Ranked Chariot, Twin Horses',
            },
            finalFen: '1r1a1kr2/9/C2c1an2/p1p3p1p/4p4/9/P1P3P1P/2N1C4/5R3/1RBAKABc1 b - - 0 1',
          },
          {
            id: 'g:cbdb596b4a5721a6aece975ca8672d84',
            title: {
              zh: '\u7b2c02\u5c40\u5f53\u5934\u70ae\u76d8\u5934\u9a6c\u8fdb\u4e2d\u5175',
              en: 'Game 2: Central Cannon, Horse at the Head, Advancing Central Pawn',
            },
            finalFen: '5a1r1/3kR4/2C2N2n/p1p3p1p/9/5p3/P1P3P1P/9/9/c1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:00833ab386773e345bda1d8ec9332220',
            title: {
              zh: '\u7b2c03\u5c40\u5f53\u5934\u70ae\u9e33\u9e2f\u9a6c\u8fdb\u4e2d\u5175',
              en: 'Game 03: Central Cannon, Tandem Horses, Advance the Central Pawn',
            },
            finalFen: '2RCka3/4a4/3cNc2n/p5p1p/9/9/P1P5P/4C4/9/2BAKAr2 b - - 0 1',
          },
          {
            id: 'g:abe15f2b8bc7dd6a94d1fbd86ca7290b',
            title: {
              zh: '\u7b2c04\u5c40\u987a\u624b\u70ae\u6a2a\u8f66\u5de6\u70ae\u5de1\u6cb3',
              en: 'Game 4: Same Direction Cannons, Ranked Chariot, Left Cannon, Riverbank Chariot',
            },
            finalFen: '3a5/4a4/nCC1k1n2/c1p1p1p1p/3r3r1/P8/2P1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:fc3b53ed1162658fa10d3a990c52ff40',
            title: {
              zh: '\u7b2c05\u5c40\u5939\u9a6c\u70ae\u76f4\u8f66\u8fdb\u4e2d\u5175',
              en: 'Game 5: Horse-Mounted Cannon, Filed Chariot, Advance the Central Pawn',
            },
            finalFen: '1rba1kb2/1C2a4/n2c2N1c/p1p1C4/4P4/6p2/P1r5P/2N1B4/4An3/1R2KAB2 b - - 0 1',
          },
          {
            id: 'g:ae32820aa6fd7a33d80744abdf8d0195',
            title: {
              zh: '\u7b2c06\u5c40\u5939\u9a6c\u70ae\u6a2a\u8f66\u8fdb\u4e2d\u5175',
              en: 'Game 06: Horse-Joining Cannon, Ranked Chariot Advances the Central Pawn',
            },
            finalFen: '3Rkab2/1N2ac3/4b4/p5p2/4C3p/4r4/P5n1P/B5N2/4A4/1c2KAB2 b - - 0 1',
          },
          {
            id: 'g:8807cabc656b5b2afc6d548ad6178604',
            title: {
              zh: '\u7b2c07\u5c40\u5c4f\u98ce\u9a6c\u76f4\u8f66\u7834\u5f53\u5934\u70ae',
              en: 'Game 07: Screen Horse Defense, Filed Chariot Breaks the Central Cannon',
            },
            finalFen: '1rba5/4an3/3c1k3/p8/4N4/2P6/P3C3P/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:f2c4d2415b7fd0d651ac58653ad6dc09',
            title: {
              zh: '\u7b2c08\u5c40\u5c4f\u98ce\u9a6c\u6a2a\u8f66\u7834\u5f53\u5934\u70ae',
              en: 'Game 08: Screen Horse Defense, Ranked Chariot Breaks Central Cannon',
            },
            finalFen: '2bakc3/4a4/4b4/8R/4CP2P/9/4r4/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:10836267fa3bf5d5c4d34e5156c3a33f',
            title: {
              zh: '\u7b2c09\u5c40\u5c4f\u98ce\u9a6c\u5de1\u6cb3\u70ae\u76f4\u8f66',
              en: 'Game 9: Screen Horse Defense, Riverbank Cannon, Filed Chariot',
            },
            finalFen: '2b2kb2/1C1RN4/n5n2/4p1p1p/2pC5/1r7/P3P1c1P/4B1N2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:2f95d76234850ea26e78f601486a4cf6',
            title: {
              zh: '\u7b2c10\u5c40\u5217\u624b\u70ae\u5c31\u6253\u5f53\u5934\u5352',
              en: 'Game 10: Opposite Direction Cannons Strike the Central Pawn',
            },
            finalFen: '4k4/n3R4/b3N3b/p8/2pP4p/5nN2/P2r4P/9/4C4/1cBAKAB2 b - - 0 1',
          },
          {
            id: 'g:5ffe59d77b11c35bbcea170dcf0163a9',
            title: {
              zh: '\u7b2c11\u5c40\u987a\u624b\u70ae\u6a2a\u8f66\u8fdb\u4e03\u5175',
              en: 'Game 11: Same Direction Cannons, Ranked Chariot Advances the Seventh Pawn',
            },
            finalFen: '2b2R3/3R2C2/n3bk3/p7p/6p2/2P6/P3P1n1P/5Ar2/4K4/cr3AB2 b - - 0 1',
          },
          {
            id: 'g:ba18aa01c87746c3b2ffeb51058eb319',
            title: {
              zh: '\u7b2c12\u5c40\u987a\u624b\u70ae\u6a2a\u8f66\u8fdb\u4e03\u5175',
              en: 'Game 12: Same Direction Cannons, Chariot Advances to the Seventh Pawn',
            },
            finalFen: 'r1bk1a3/3na4/3c1cC2/p2C1N2p/6p2/9/Pr2P1P1P/B5N2/4A4/R3KAB2 b - - 0 1',
          },
          {
            id: 'g:db8eeaf83a10f5e8b53669c2f27a51b7',
            title: {
              zh: '\u7b2c13\u5c40\u5939\u9a6c\u70ae\u76f4\u8f66\u8fdb\u4e2d\u5175',
              en: 'Game 13: Horse-Clipping Cannon, Filed Chariot Advances the Central Pawn',
            },
            finalFen: '1Rb1ka1r1/3C5/2N1ba2n/p5p1p/2p1r4/9/P1P3P1P/9/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:63f4e1086278bce06ed42c493bfbb526',
            title: {
              zh: '\u7b2c14\u5c40\u987a\u624b\u70ae\u76f4\u8f66\u7834\u91d1\u9e4f',
              en: 'Game 14: Same Direction Cannons, Filed Chariot, Break Jinpeng',
            },
            finalFen: 'rnbakab2/1R7/4c1n2/p1Crp1p1p/9/9/P1P1P1P1P/N1C3N2/9/2BcKABR1 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'meihuapu',
    title: {
      zh: '\u6885\u82b1\u8c31',
      en: 'Plum Flower Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u5f53\u5934\u70ae\u7834\u8fc7\u5bab\u70ae',
          en: 'Central Cannon Breaks Cross-Palace Cannon',
        },
        games: [
          {
            id: 'g:0ddddb732640aad0d0278b3e80fcc625',
            title: {
              zh: '\u7b2c1\u5c40\u6a2a\u8f66\u7834\u5de1\u6cb3\u8f66\u5e73\u4e03\u5403\u5352',
              en: 'Game 1: Ranked Chariot Breaks Riverbank Chariot, Ranks to the Seventh File and Captures a Pawn',
            },
            finalFen: '1C2kab2/4a4/b8/p4Np1p/9/2P2p3/P4nP1P/R8/9/1cBrK1B2 w - - 0 1',
          },
          {
            id: 'g:4d3c3ebd0103110baf1c7038c518e4f1',
            title: {
              zh: '\u7b2c2\u5c40\u6a2a\u8f66\u7834\u5de6\u70ae\u5e73\u4e03\u8def\u53d6\u9a6c',
              en: 'Game 2: Ranked Chariot Breaks a Left Cannon, Ranks Seven Files, and Captures a Horse',
            },
            finalFen: '1R1Ckab2/4a4/5c3/p5p1p/9/2B6/P3r1n1P/5A3/R2N1Kn2/5AB2 w - - 0 1',
          },
          {
            id: 'g:d7d13cd81d85645d823e0b5d1ae0a6ca',
            title: {
              zh: '\u7b2c3\u5c40\u6a2a\u8f66\u5939\u9a6c\u7834\u8fc7\u5bab\u70ae\u79fb\u4e2d',
              en: 'Game 3: Ranked Chariot and Horse Break the Cross-Palace Cannon and Shift to the Center',
            },
            finalFen: '2Ck1ab2/4a4/7r1/p5p1p/9/4R4/P1Pr2P1P/N2R1An2/4AK3/2B3B2 w - - 0 1',
          },
          {
            id: 'g:b59eb690f37262b7a7b0bca2fc668f03',
            title: {
              zh: '\u7b2c4\u5c40\u6a2a\u8f66\u9000\u70ae\u7834\u516b\u8def\u70ae\u8fc7\u6cb3',
              en: 'Game 4: Ranked Chariot Retreats the Cannon to Break the Eight-Route Cannon Crossing the River',
            },
            finalFen: 'C1baka3/9/2n1b4/pc4p1p/9/9/P1P1P1P1P/6r2/4A1R2/3AK1B2 w - - 0 1',
          },
          {
            id: 'g:a9198af594505fff2b9c81dab2341db1',
            title: {
              zh: '\u7b2c5\u5c40\u6a2a\u8f66\u7834\u8fc7\u6cb3\u8f66\u5403\u5352\u538b\u9a6c',
              en: 'Game 5: Ranked Chariot Breaks the Riverbank Chariot, Captures a Pawn, and Presses the Horse',
            },
            finalFen: '1rbakaR2/3r5/9/p1p5p/9/4P1P2/P1P5P/1R1C3C1/4A1n2/3K1c3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5f53\u5934\u70ae\u7834\u8f6c\u89d2\u9a6c',
          en: 'Central Cannon Breaks Corner Horse',
        },
        games: [
          {
            id: 'g:f4f1c343112fe5af72c6f1aac530a533',
            title: {
              zh: '\u7b2c1\u5c40\u53d6\u4e2d\u5175\u538b\u9a6c\u7834\u4e0a\u53f3\u58eb',
              en: 'Game 1: Central Pawn Presses the Horse to Break the Upper Right Advisor',
            },
            finalFen: '1Rba1kb2/4a4/6n2/p3p1p1p/4N4/9/P1P3P2/C3B4/4A4/2BAKr2c w - - 0 1',
          },
          {
            id: 'g:abfa17b153577f863fc3713d50e7551d',
            title: {
              zh: '\u7b2c2\u5c40\u53d6\u4e2d\u5175\u538b\u9a6c\u7834\u5de6\u58eb\u5151\u70ae',
              en: 'Game 2: Central Pawn Presses the Horse to Break the Left Advisor, Exchanging Cannons',
            },
            finalFen: '2bakab2/9/6n2/p1P3p1p/9/9/PR3NP1P/4B4/3p1r3/2B1KAC1c w - - 0 1',
          },
          {
            id: 'g:f4b2ae42f714e6d312a64b53eca27787',
            title: {
              zh: '\u7b2c3\u5c40\u53d6\u4e2d\u5175\u538b\u9a6c\u7834\u5de6\u58eb\u5e73\u70ae',
              en: 'Game 3: Advance the Central Pawn to Pressure the Horse and Break the Left Advisor Cannon',
            },
            finalFen: '2b1kab2/4a4/9/p2C4p/9/2P6/P3R3P/9/3rA1n2/2B1KA3 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5217\u624b\u70ae',
          en: 'Opposite Direction Cannons',
        },
        games: [
          {
            id: 'g:4d42cd4dc52735a341e2d7a3afce0265',
            title: {
              zh: '\u7b2c1\u5c40\u5de1\u6cb3\u8f66\u653b\u8f66\u5b88\u6cb3\u53e3\u5151\u5175',
              en: 'Game 1: Riverbank Chariot Attacks, Chariot Defends the River Mouth and Trades Pawns',
            },
            finalFen: 'C3kab2/4a4/c7n/p3p1p1p/1RRr3r1/P8/4P1c1P/4B1N2/9/2BAKA3 w - - 0 1',
          },
          {
            id: 'g:e20aefb7b239de587ee34e0f5570a896',
            title: {
              zh: '\u7b2c2\u5c40\u653b\u53f3\u8f66\u5b88\u6cb3\u53e3\u540e\u4e0a\u9a6c\u6253\u8f66',
              en: 'Game 2: Attack the Right Chariot, Guard the River Mouth, Then Advance the Horse to Attack the Chariot',
            },
            finalFen: '2ba3r1/5k3/2P1b4/p3C4/5N2p/P8/6P1c/5C3/4A4/1rBK1ABc1 b - - 0 1',
          },
          {
            id: 'g:e4dd49675ed815b04d1a65055ba3ec15',
            title: {
              zh: '\u7b2c3\u5c40\u653b\u53f3\u8f66\u5b88\u6cb3\u53e3\u540e\u5e73\u70ae\u5151\u8f66',
              en: 'Game 3: Attack the Right Chariot, Defend the River Mouth, Then Exchange Cannons for Chariots',
            },
            finalFen: '2ba1kb2/4a4/2N5n/1R3Cp1p/2p6/P2R3N1/2P1P3P/5A3/7r1/2BAK3c b - - 0 1',
          },
          {
            id: 'g:fa53ff330b438b3ee179273afcc90fff',
            title: {
              zh: '\u7b2c4\u5c40\u653b\u53f3\u8f66\u8fc7\u6cb3\u540e\u5e73\u70ae\u5151\u8f66',
              en: 'Game 4: After Attacking, the Right Chariot Crosses the River and the Cannon Tries to Trade Chariots',
            },
            finalFen: '1Cb6/5k3/3cba3/p3R2Rp/2p6/5p1n1/P7P/2c1B1r2/4A4/3K1AB2 b - - 0 1',
          },
          {
            id: 'g:d81a78cd33fb16499df245c8bb2dd52d',
            title: {
              zh: '\u7b2c5\u5c40\u653b\u672a\u8fdb\u53f3\u8f66\u5148\u5e73\u70ae\u5151\u8f66',
              en: 'Game 5: Before the Attack Advances, the Right Chariot First Trades by Cannon',
            },
            finalFen: 'CR3ab2/2r1k4/b2ac3n/4p1p1p/9/P4R3/4P1c1P/4B1N2/2r6/2BAKA3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae',
          en: 'Screen Horse Defense Breaks Central Cannon',
        },
        games: [
          {
            id: 'g:93cac6c2579b17d14b9719f27d64207c',
            title: {
              zh: '\u7b2c1\u5c40\u7834\u5de1\u6cb3\u8f66\u5403\u5352\u7528\u70ae\u6253\u8c61',
              en: 'Game 1: Break the Riverbank Chariot, Capture the Pawn, and Use the Cannon to Attack the Elephant',
            },
            finalFen: '2baka3/8r/4b4/p3p3p/5c3/3r5/P1P1P3P/2N1K1C1N/4C2c1/2BAnABR1 w - - 0 1',
          },
          {
            id: 'g:447c8daae4727f995c8b05464bdabe08',
            title: {
              zh: '\u7b2c2\u5c40\u7834\u70ae\u5148\u53bb\u8c61\u540e\u4e0a\u4e09\u8def\u9a6c',
              en: 'Game 2: Break the Cannon First, Then Retreat the Elephant and Bring Up the Third-Rank Horse',
            },
            finalFen: '3a1k3/4a4/2n1b2c1/p3p3p/7n1/9/P1P1P1R2/2N1C4/4K4/2BA1rB2 w - - 0 1',
          },
          {
            id: 'g:a4ce8197071654a390e5e614338114c4',
            title: {
              zh: '\u7b2c3\u5c40\u7834\u70ae\u6253\u8c61\u540e\u6362\u58eb\u4e0a\u53f3\u9a6c',
              en: 'Game 3: After Breaking the Cannon and Capturing the Elephant, Reposition the Advisor and Develop the Right Horse',
            },
            finalFen: '4kr3/4a4/4b4/p2r1n2R/4C4/9/P1p1P3P/4B4/c3A4/1cBAK3R w - - 0 1',
          },
          {
            id: 'g:90e55cd98c08c491d1627a94dd2962f0',
            title: {
              zh: '\u7b2c4\u5c40\u9000\u70ae\u7834\u5de1\u6cb3\u8f66\u633a\u5175\u5151\u5352',
              en: 'Game 4: Retreat the Cannon to Break the Riverbank Chariot, Then Advance the Pawn to Trade Pawns',
            },
            finalFen: '4kab2/4ac1r1/4R4/p3pR2p/9/9/P3P1N1P/2C2A3/2nr1K3/2B6 w - - 0 1',
          },
          {
            id: 'g:f40f730cad41c6d9b36e682c8962e783',
            title: {
              zh: '\u7b2c5\u5c40\u9000\u70ae\u6a2a\u8f66\u7834\u5de1\u6cb3\u8f66\u8fb9\u9a6c',
              en: 'Game 5: Retreat Cannon, Ranked Chariot Breaks the Riverbank Chariot and Horse',
            },
            finalFen: '2ba1k3/3R5/9/p3p3p/2p6/9/P2n4P/1C2B3N/1c1NK4/2cA1A3 w - - 0 1',
          },
          {
            id: 'g:dcee7bba7eb263403b3de3f089125913',
            title: {
              zh: '\u7b2c6\u5c40\u9000\u53f3\u70ae\u7834\u8fc7\u6cb3\u8f66\u8d2a\u5403\u5352',
              en: 'Game 6: Retreating Right Cannon Breaks the River-Crossing Chariot by Greedy Pawn Capture',
            },
            finalFen: '2baka3/9/2R1b4/p3p3p/5n3/1NP6/P3P3P/4cC2N/4Ar3/4KAB1c w - - 0 1',
          },
          {
            id: 'g:9b4a7b3ee44d9a4f37cf83dc16aca4a6',
            title: {
              zh: '\u7b2c7\u5c40\u98de\u8c61\u8fdb\u9a6c\u7834\u8fc7\u6cb3\u8f66\u8fb9\u9a6c',
              en: 'Game 7: Elephant Opening and Horse Advance Break the River-Crossing Chariot and Flank Horse',
            },
            finalFen: '2bak3r/4a4/2n1b4/p7p/4c4/2P3R2/P3P1P1P/2N4CN/4A4/cr2KAB1R w - - 0 1',
          },
          {
            id: 'g:ef7aadf1b31daaa2e8000960bba23daa',
            title: {
              zh: '\u7b2c8\u5c40\u633a\u9a6c\u524d\u5352\u7834\u76f4\u6a2a\u8f66\u8fb9\u9a6c',
              en: 'Game 8: Horse Pawn Advances to Break the Filed and Ranked Chariots, Edge Horse',
            },
            finalFen: '1Rbak4/4a4/4b1c2/p3p3p/9/2p6/P3P3P/1r7/4A4/1N2KA1Cc w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66',
          en: 'Same Direction Cannons, Ranked Chariot Breaks Filed Chariot',
        },
        games: [
          {
            id: 'g:f5803aa8bada26afa11a56363481d83e',
            title: {
              zh: '\u7b2c1\u5c40\u653b\u76f4\u8f66\u8fc7\u6cb3\u6349\u9a6c\u58eb\u89d2\u70ae',
              en: 'Game 1: Attack with a Filed Chariot, Cross the River, Capture the Horse, Palcorner Cannon',
            },
            finalFen: 'r1b1ka3/3R5/n2cCa3/p3C3p/5np2/2P6/P3P3P/1r7/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:11a673f15658bc6256a88a1c3f79b9fb',
            title: {
              zh: '\u7b2c2\u5c40\u653b\u76f4\u8f66\u5b88\u6cb3\u53e3\u633a\u5352\u5151\u5175',
              en: 'Game 2: Attack the Filed Chariot, Defend the River Mouth, and Exchange Pawns for Pawns',
            },
            finalFen: '1Rb1ka3/4a4/4r3b/p1n5p/6p2/4C4/P3P1P1P/B5N2/4A4/c2K1AB2 b - - 0 1',
          },
          {
            id: 'g:b821f9178a3ecd9b191e7757ffed33dd',
            title: {
              zh: '\u7b2c3\u5c40\u653b\u76f4\u8f66\u5b88\u6cb3\u518d\u8865\u58eb\u89d2\u70ae',
              en: 'Game 3: Attack the Filed Chariot, Defend the River, Then Add the Palcorner Cannon',
            },
            finalFen: 'r1bk1a3/2R6/1c1N1a3/3C3c1/p7p/3n5/P7P/9/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:ac8476484e7553abccc633901deb2c8c',
            title: {
              zh: '\u7b2c4\u5c40\u633a\u8fb9\u5175\u8dc3\u8fb9\u9a6c\u653b\u4e0a\u5de6\u58eb',
              en: 'Game 4: Flank Pawn Advances and Flank Horse Jumps to Attack the Left Advisor',
            },
            finalFen: '1rbR1kb2/4R1Nr1/n5n2/p1p1p1p1p/4c4/P8/2P5P/9/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:89d63cd9b1847986d13747f5bf300270',
            title: {
              zh: '\u7b2c5\u5c40\u5de6\u70ae\u8fc7\u6cb3\u653b\u4e0a\u8fb9\u9a6c\u51fa\u8f66',
              en: 'Game 5: Left Cannon Crosses the River to Attack, the Upper Horse Develops, and the Chariot Comes Out',
            },
            finalFen: '1Cra1kb2/2N6/4b1n2/p3p1p1p/6r2/P8/5R2P/5A3/4A4/2c1K4 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66',
          en: 'Same Direction Cannons, Filed Chariot Breaks Ranked Chariot',
        },
        games: [
          {
            id: 'g:995e9c18f07cacbffbba7f70f31f0064',
            title: {
              zh: '\u7b2c1\u5c40\u5de1\u6cb3\u70ae\u653b\u6a2a\u8f66\u5c3e\u968f\u6349\u9a6c',
              en: 'Game 1: Riverbank Chariot Attack with a Pursuing Chariot and Horse Capture',
            },
            finalFen: '2b1kabc1/r3a4/n3c4/p1p1C3p/5R3/9/P1P1P1P1P/3R2N2/4A4/1rBA1KB2 b - - 0 1',
          },
          {
            id: 'g:e016cbf308277bdccbb862f290d357d9',
            title: {
              zh: '\u7b2c2\u5c40\u5de1\u6cb3\u70ae\u653b\u6a2a\u8f66\u62e6\u6cb3\u53bb\u5175',
              en: 'Game 2: Riverbank Cannon Attacks; Ranked Chariot Blocks the River and Trades Pawns',
            },
            finalFen: '3a1a3/3k5/nR7/p1p1C3p/9/4C4/P3P1c1P/B5N2/3rA4/3AK1B2 b - - 0 1',
          },
          {
            id: 'g:1050725bd58e25c50d68505801356271',
            title: {
              zh: '\u7b2c3\u5c40\u5de1\u6cb3\u70ae\u653b\u6a2a\u8f66\u9000\u800c\u590d\u8fdb',
              en: 'Game 3: Riverbank Cannon Attacks the Ranked Chariot, Then Advances Again',
            },
            finalFen: '2b1kab2/4a4/r3c1R2/2p1C3p/p8/5r3/P3P1P1P/4B1N2/9/R2AKAB2 b - - 0 1',
          },
          {
            id: 'g:4060299a4548c4a0f6c3950d1b0777ce',
            title: {
              zh: '\u7b2c4\u5c40\u5de1\u6cb3\u70ae\u653b\u6a2a\u8f66\u62e6\u6cb3\u8f67\u70ae',
              en: 'Game 4: Riverbank Cannon Attacks the Ranked Chariot, Blocking the River and Crushing the Cannon',
            },
            finalFen: '2bk1an2/2N1a4/n3rr3/p1pC4p/9/3C5/P3P1P1P/B5N2/9/3cKAB2 b - - 0 1',
          },
          {
            id: 'g:a1900d53ec8daee89a676fc9dd78c92d',
            title: {
              zh: '\u7b2c5\u5c40\u653b\u5de1\u6cb3\u70ae\u518d\u633a\u8fb9\u5352',
              en: 'Game 5: Attack with the Riverbank Cannon, Then Advance the Edge Pawn',
            },
            finalFen: 'r1b1k1b2/4R4/n1N6/2p1p3p/9/p8/P5P1P/B3r4/4AK3/3A5 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'meihuabianfa',
    title: {
      zh: '\u6885\u82b1\u53d8\u6cd5\u8c31',
      en: 'Plum Flower Variations Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u6885\u82b1\u53d8\u6cd5\u8c31',
          en: 'Plum Flower Variations Manual',
        },
        games: [
          {
            id: 'g:af7113e4b4a2064af4da96a2f1866214',
            title: {
              zh: '\u7b2c10\u5c40\u8ba9\u5148\u5217\u70ae\u5bf9\u653b\u53cc\u76f4\u8f66',
              en: 'Game 10: Handicap Opposite Direction Cannons, Counterattack with Double Filed Chariots',
            },
            finalFen: '3ak1b2/4a4/b3c4/p3R4/2p5p/P8/2P1P4/3C1A3/7r1/2BAK3c w - - 0 1',
          },
          {
            id: 'g:c6c96d78694824d8e25e18fb5c2a2f90',
            title: {
              zh: '\u7b2c11\u5c40\u5f97\u5148\u9876\u5934\u5352\u5bf9\u653b\u4e00\u5175\u62a2\u4e09\u5148',
              en: 'Game 11: Gain the Initiative with a Front Pawn, Counterattack with One Pawn, Seize Three Tempi',
            },
            finalFen: '1C1N1kb2/3P5/c3ban2/p4Rp1p/4P2r1/9/P5P1P/4B2C1/9/3AKABc1 b - - 0 1',
          },
          {
            id: 'g:b543f06c0fbaf932173d89edb98b228c',
            title: {
              zh: '\u7b2c12\u5c40\u8ba9\u5148\u5c4f\u98ce\u9a6c\u5bf9\u653b\u7a7f\u5bab\u9a6c',
              en: 'Game 12: Red to Move First; Screen Horse Defense Faces Off Against Cross-Palace Horse',
            },
            finalFen: '3akab2/9/4b1n2/p5p1p/2P6/4R1P2/P6r1/C2AB2C1/6cr1/RNBA1K2c w - - 0 1',
          },
          {
            id: 'g:22c996fc2a6e67accd454b26b9af1cd5',
            title: {
              zh: '\u7b2c1\u5c40\u8ba9\u5148\u5c4f\u98ce\u9a6c\u5bf9\u653b\u5f53\u95e8\u70ae',
              en: 'Game 1: Letting Red Move First, Screen Horse Defense Against the Central Cannon',
            },
            finalFen: '3akab2/9/2C1b4/p3p3p/1R7/2P6/P3P3P/N4A1n1/4AK3/2B3c1c w - - 0 1',
          },
          {
            id: 'g:caaf37d751a1e4b7d827dca2ade89bd2',
            title: {
              zh: '\u7b2c2\u5c40\u8ba9\u5148\u5c4f\u98ce\u9a6c\u5bf9\u653b\u5f53\u95e8\u70ae',
              en: 'Game 2: Letting Red Move First, Screen Horse Defense Against the Central Cannon',
            },
            finalFen: '3k1a3/4a4/2R6/p7p/6p2/2B3P2/P3c3P/4n4/5K2N/5rB2 w - - 0 1',
          },
          {
            id: 'g:bfb50822a9d9f36673a0bc429c4aaad8',
            title: {
              zh: '\u7b2c3\u5c40\u5f97\u5148\u5f53\u95e8\u70ae\u5bf9\u653b\u5c4f\u98ce\u9a6c',
              en: 'Game 3: Central Cannon Attack Against Screen Horse Defense',
            },
            finalFen: '2bk1a3/2N1a4/3cb4/p7R/4r4/2P5P/P8/4B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:5980a0a61875eb1fa0b952655de8e923',
            title: {
              zh: '\u7b2c4\u5c40\u5f97\u5148\u5f53\u95e8\u70ae\u5bf9\u653b\u5c4f\u98ce\u9a6c',
              en: 'Game 4: Counter the Screen Horse Defense with the Central Cannon',
            },
            finalFen: '3k1a3/4a4/4C2c1/p3n3p/9/4P4/P5P1P/2N3N2/4K4/c2A1AB2 b - - 0 1',
          },
          {
            id: 'g:ed2bbc4f6a881fc9b01daa3af93fe772',
            title: {
              zh: '\u7b2c5\u5c40\u8ba9\u5148\u987a\u70ae\u76f4\u8f66\u653b\u6a2a\u8f66',
              en: 'Game 5: Red to Move First; Same Direction Cannons, Filed Chariot Attacks Ranked Chariot',
            },
            finalFen: '3nkab2/4a4/1R2b4/p1pR4p/9/2P6/P5P1P/4r4/4A4/4KAr2 w - - 0 1',
          },
          {
            id: 'g:8dd1d126bbbe70fa75bce9bed1be8bfe',
            title: {
              zh: '\u7b2c6\u5c40\u8ba9\u5148\u987a\u70ae\u6a2a\u8f66\u653b\u76f4\u8f66',
              en: 'Game 6: Handicap Game, Same Direction Cannons, Filed Chariot Attacks a Ranked Chariot',
            },
            finalFen: '2bakab2/9/6R2/4p3p/2p3P2/9/2P1c3P/R1C1C4/4A4/1cB1K1B2 w - - 0 1',
          },
          {
            id: 'g:cb8d851fbe0b6bd8e75231c414fc4dde',
            title: {
              zh: '\u7b2c7\u5c40\u8ba9\u5148\u987a\u70ae\u6a2a\u8f66\u653b\u76f4\u8f66',
              en: 'Game 7: Handicap, Same Direction Cannons, Ranked Chariot Attacks the Filed Chariot',
            },
            finalFen: '3ak1C2/9/b2a5/p2c4p/9/2B6/P2c3RP/3K5/9/2BA5 w - - 0 1',
          },
          {
            id: 'g:7fd12d608ef71c738f2cb0188a077139',
            title: {
              zh: '\u7b2c8\u5c40\u8ba9\u5148\u987a\u70ae\u6a2a\u8f66\u653b\u6a2a\u8f66',
              en: 'Game 8: Handicap Same Direction Cannons, Ranked Chariot Attacks with a Ranked Chariot',
            },
            finalFen: '2C2k3/9/R8/2p1p1p1p/p3c4/9/P1P1P3P/N2K5/4r4/2B2rB2 w - - 0 1',
          },
          {
            id: 'g:6b6aea511b2a011446b7fc1ae557c991',
            title: {
              zh: '\u7b2c9\u5c40\u5f97\u5148\u5217\u70ae\u5bf9\u653b\u76f4\u6a2a\u8f66',
              en: 'Game 9: Gain the First Move; Opposite Direction Cannons Attack the Filed and Ranked Chariots',
            },
            finalFen: '4kab2/5R3/1rNa4n/p5p2/2p4rp/9/P3C1c1P/2N1C4/9/2BAKAB2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'juzhongmi',
    title: {
      zh: '\u6854\u4e2d\u79d8',
      en: 'Secret in the Tangerine',
    },
    chapters: [
      {
        title: {
          zh: '\u5f97\u5148',
          en: 'Red to Move',
        },
        games: [
          {
            id: 'g:da7f879d0a5911049d3c89f51397aa02',
            title: {
              zh: '\u5217\u70ae\u7834\u655b\u70ae018',
              en: 'Opposite Direction Cannons Break the Constricted Cannon 018',
            },
            finalFen: '6b1r/2R1Ckc2/4R3n/p1p3p1p/9/2P6/P3P1P1P/3r2N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:9082dfe595e339bfb1fa9e3a510b0327',
            title: {
              zh: '\u5217\u70ae\u7834\u8865\u58eb\u89d2\u70ae019',
              en: 'Opposite Direction Cannons Break Supplemental Palcorner Cannon 019',
            },
            finalFen: '1R1akab1r/2CR5/2n1cc2n/p1p1p3p/6p2/2P6/P3P1P1P/2r1C1N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:a7e1d1e0cc1ac41aa0e308254ed82e25',
            title: {
              zh: '\u53f3\u70ae\u6a2a\u8f66\u7834\u7f20\u89d2\u9a6c\u8c61\u5c40015',
              en: 'Right Cannon, Ranked Chariot Breaks Entwined Horse-Elephant Formation 015',
            },
            finalFen: 'r3kCbr1/4aR3/1c2b2cn/p1p1C1p1p/6n2/9/P1P1P1P1P/6N2/9/RNBAKAB2 b - - 0 1',
          },
          {
            id: 'g:edf4f47b66a5df2095544aef862f5393',
            title: {
              zh: '\u53f3\u70ae\u6a2a\u8f66\u7834\u8c61\u5c40014',
              en: 'Right Cannon, Ranked Chariot Breaks the Elephant Formation 014',
            },
            finalFen: '1Ccrkab1r/4a4/4b3n/p3C1p1p/9/9/P1P1P1P1P/3R5/6c2/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:d970dcafd370f70a8ea1bfdb96cf361e',
            title: {
              zh: '\u53f3\u70ae\u76f4\u8f66\u7834\u53f3\u5355\u63d0\u9a6c\u58eb\u8c61\u5c40013',
              en: 'Right Cannon, Filed Chariot, Breaks the Right Single Horse Defense and Advisor-Elephant Line 013',
            },
            finalFen: 'C1bn1Rb1r/5k3/4N3n/2p3p1p/9/9/2Pr2P1P/2c1C4/9/c1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:1e610c3a8489d1623881ccb35f2188b1',
            title: {
              zh: '\u53f3\u70ae\u76f4\u8f66\u7834\u5de6\u5355\u63d0\u9a6c\u58eb\u8c61\u5c40012',
              en: 'Right Cannon, Filed Chariot Breaks Left Single Horse Defense and Elephant Formation 012',
            },
            finalFen: 'r1bak2r1/4a1c2/nc2b1N2/p1p3R1p/4p1p2/9/P1P3P1P/1C2C1N2/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:02aa571b9eba76d68dec8157e1c88c95',
            title: {
              zh: '\u5927\u5217\u624b\u70ae\u5c40016',
              en: 'Opposite Direction Cannons 016',
            },
            finalFen: '1Cb2Rb2/5k3/2c1c4/p3C1p2/2p2r1np/P8/2P1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:5177b442e15008cd7875d609b35bf07f',
            title: {
              zh: '\u5c0f\u5217\u624b\u7834\u5927\u5217\u624b\u70ae\u5c40017',
              en: 'Small Opposite Direction Cannons Break Large Opposite Direction Cannons, 017',
            },
            finalFen: '2N2ab2/9/3Rk4/p7p/6r2/9/P1P1P3P/9/4A4/1NBAK2c1 b - - 0 1',
          },
          {
            id: 'g:3a83c5f353441155fccd1de98ddfb855',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae020',
              en: 'Screen Horse Defense Breaks the Central Cannon 020',
            },
            finalFen: 'r1b2k3/4R4/n1c1c3b/p2R5/2p1p1p2/6P2/P1P1P3P/2N1B1r2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:a87a51b5d3199d07552706106529671d',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u5148\u8865\u58eb\u89d2\u70ae007',
              en: 'Same Direction Cannons, Ranked Chariot Breaks the Advanced Rear-Backing Palcorner Cannon 007',
            },
            finalFen: '2bak1br1/4a4/2ncc1n2/p1N1p3p/5rp2/P2R5/2P1P1P1P/2C1C1N2/9/1RBAKAB2 b - - 0 1',
          },
          {
            id: 'g:2004d08db14d1de9d031532ae13a0c70',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u5939\u9a6c\u70ae009',
              en: 'Same Direction Cannons, Ranked Chariot, Break Horse-Mounted Cannon 009',
            },
            finalFen: 'r1bakabr1/9/1c2c1n2/pCR3p1p/4p1n2/6P2/P1P1P3P/4C1N2/9/RNBAKAB2 b - - 0 1',
          },
          {
            id: 'g:951bee2b5adee84aff00b015b21fffd1',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u4e0d\u98df\u5f03\u9a6c003',
              en: 'Same Direction Cannons, Ranked Chariot Breaks Filed Chariot Without Capturing, Sacrificing the Horse 003',
            },
            finalFen: '1CC1k1b2/3ca4/b2a2n2/p3p1p1p/2p6/9/P1P1c3P/4K4/8r/1NBA1AB2 b - - 0 1',
          },
          {
            id: 'g:7ee871cad8d4130a7fbe10c7ee9e4977',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u4ed6\u5148\u4e0a\u9a6c\u5f03\u9a6c002',
              en: 'Same Direction Cannons, Ranked Chariot, Breaking a Filed Chariot: He First Develops the Horse and Sacrifices a Horse 002',
            },
            finalFen: '2bak2r1/3Ra4/2N3R2/2p3p1p/9/6P2/8P/4n4/4K4/1cBA1A3 b - - 0 1',
          },
          {
            id: 'g:4631ee0f359014152b7aa8bb14e2ac4c',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u9a6c001',
              en: 'Same Direction Cannons, Ranked Chariot Breaks Filed Chariot, Sacrificing the Horse 001',
            },
            finalFen: 'r1bak1bn1/9/n3CR3/p1p1C1p1p/9/9/P1P1P1PrP/6N2/9/1cBAKAB2 b - - 0 1',
          },
          {
            id: 'g:1867a71ff5fcffee088888fc3ccde431',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u7528\u9a6c004',
              en: 'Same Direction Cannons, Ranked Chariot, Breaking a Filed Chariot with a Horse 004',
            },
            finalFen: 'r1b1kaC2/3Ra4/n2cn4/p7p/6p2/2P6/P3P3P/1r7/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:309c88dbb75cba9f65c808fa2ca8832a',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u7528\u9a6c005',
              en: 'Same Direction Cannons: Ranked Chariot Breaks Filed Chariot, Using the Horse 005',
            },
            finalFen: '1Cb1k1b2/4a4/r1c1c4/2p1C3p/9/2P2p3/4P3P/6r2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:fec84be1957c4214af202b55ca5e74be',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u80cc\u8865\u58eb\u89d2\u70ae006',
              en: 'Same Direction Cannons, Ranked Chariot, Break Rear-Guard Palcorner Cannon 006',
            },
            finalFen: '1rbk2b2/1C2a1N2/n3c1n2/p1p1p1p1p/3R5/P8/2P1P1r1P/3C2N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:2d5c71b7dbc81908feaaf51f44094d80',
            title: {
              zh: '\u987a\u70ae\u76f4\u8f66\u5de6\u70ae\u5de1\u6cb3\u7834\u6a2a\u8f66010',
              en: 'Same Direction Cannons: Filed Chariot, Left Cannon Patrols the River, Breaking Ranked Chariot 010',
            },
            finalFen: '2bR1k3/4ar3/nr2N4/p1p1C3p/3c5/9/P3P1P1P/B5N2/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:6e3aed200396d98674a3e268f3ad8db3',
            title: {
              zh: '\u987a\u70ae\u76f4\u8f66\u5de6\u70ae\u5de1\u6cb3\u7834\u6a2a\u8f66\u5939\u9a6c011',
              en: 'Same Direction Cannons, Filed Chariot, Left Cannon, Riverbank Cannon, Break the Ranked Chariot, Flank Horse, 011',
            },
            finalFen: 'r1ba1kC2/4a1RCn/n1c1c4/p1p1p3p/9/9/P1P1P1P1P/2N6/3rN4/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:4842950f4b24d5922b4edab08ee1521c',
            title: {
              zh: '\u987a\u70ae\u7a9d\u5fc3\u6a2a\u8f66\u7834\u58eb\u89d2\u70ae008',
              en: 'Same Direction Cannons, Heart-Filed Ranked Chariot Breaks Palcorner Cannon 008',
            },
            finalFen: '2bckabr1/9/2naC4/p1p1C1p1p/9/9/P1r1N1P1P/6N2/9/R1BAKAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u53cc\u9a6c',
          en: 'Black Gives Both Horses',
        },
        games: [
          {
            id: 'g:005ace900735250903bf67011568095f',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u53f3\u5355\u63d0\u9a6c003',
              en: 'Handicap Double Horses - Riverbank Cannon Breaks the Right Single Horse Defense 003',
            },
            finalFen: '2bak3r/r3aR3/c1c1b4/p3C1p1p/2p6/9/P1P1P1P1P/9/9/1RBAKAB2 b - - 0 1',
          },
          {
            id: 'g:50ca7e66e1b057ab9f536f068c601cda',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u5c4f\u98ce\u9a6c007',
              en: 'Handicap Two Horses - Riverbank Cannon Breaking the Screen Horse 007',
            },
            finalFen: 'r1b1kaC2/4a4/1cn5c/p1p1p3p/9/9/P1P1P1P1P/9/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:7d3a7c3eb6a8c4fe89db960e2a71e031',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u5de6\u5355\u63d0\u9a6cJ004',
              en: 'Two-Horse Handicap: River-Patrol Cannon Defeats Left Single Horse Defense J004',
            },
            finalFen: 'r1b1ka1cr/4a3n/nc2b4/p1p3p1C/9/8C/P1P1P1P1P/9/9/R1BAKABR1 b - - 0 1',
          },
          {
            id: 'g:1a1c8901cd1a26ca5eadc43f24e9e350',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u5f53\u5934\u70ae\u4e0d\u53d6\u5175002',
              en: 'Two-Horse Handicap: River-Patrol Cannon Breaks Central Cannon Without Capturing the Pawn 002',
            },
            finalFen: '3ak2r1/4a4/ncR1c1n1b/p3p1p1p/9/9/P2pP1P1P/1C7/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:342bb644d02e1f7129e318cdd937a023',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u5f53\u5934\u70ae\u53d6\u5175001',
              en: 'Let Two Horses - Riverbank Cannon Breaks the Central Cannon and Wins a Pawn 001',
            },
            finalFen: '1R4C2/4k2C1/3rc1n1r/p1p1p1p1p/9/9/P1P1c1P1P/9/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:c1c86624f0473a1d5b6276b42559048a',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u5de1\u6cb3\u70ae\u7834\u8c61\u5c40006',
              en: '006 Handicap Game: Double Horses \u2014 Riverbank Cannon Breaks the Elephant Formation',
            },
            finalFen: 'r1ba1ab1r/5k3/nR5c1/p1p1C1p1p/9/9/P1P1C1P1P/9/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:f6f1e62941817dfdd9152f66efdb55b9',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u7834\u6597\u5de1\u6cb3\u70ae005',
              en: 'Let Two Horses - Break the River Patrol Cannon 005',
            },
            finalFen: '2b1kabr1/4a4/2R1c3n/p1p1C1p1p/1c7/1C7/P1P1P1P1P/9/4A4/2BK1AB2 b - - 0 1',
          },
          {
            id: 'g:2631bb61398a44e58a0d4b14ae8d4cf6',
            title: {
              zh: '\u8ba9\u53cc\u9a6c-\u7a9d\u5fc3\u70ae\u7834\u53f3\u5355\u63d0\u9a6c008',
              en: 'Handicap Double Horses - Heart Cannon Breaks the Right Single Horse Defense 008',
            },
            finalFen: '2R2abr1/3ka4/7cn/p1p3p1p/4C4/9/c1P3P1P/3C5/9/2BAKAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5148',
          en: 'Black Gives the First Move',
        },
        games: [
          {
            id: 'g:d1799f19effa4a90ac91b33d7cb9d634',
            title: {
              zh: '\u8ba9\u5148-\u4e2d\u70ae\u7834\u58eb\u8c61\u8f6c\u89d2\u9a6c\u5c40013',
              en: 'Give Red the Move \u2014 Central Cannon Breaks the Advisor-and-Elephant Corner Horse Formation 013',
            },
            finalFen: 'r1bakab2/1R7/6n2/p1p3p1p/9/4N4/P1P3P2/NC3A3/9/1R1AKn1rc w - - 0 1',
          },
          {
            id: 'g:a1801a4064a0f9bf87e6e651ddfdf121',
            title: {
              zh: '\u8ba9\u5148-\u5217\u624b\u70ae\u5151\u8f66\u538b\u9a6c010',
              en: 'Red to Move First: Opposite Direction Cannons Exchange Chariots and Pressure the Horse 010',
            },
            finalFen: '2baka2r/9/4b1n2/p7p/2p1c4/9/P1P3P1P/6N2/9/1NBAKAB2 w - - 0 1',
          },
          {
            id: 'g:4d5c32759f518fd0577f78b6534101a5',
            title: {
              zh: '\u8ba9\u5148-\u5927\u5217\u624b\u70ae\u5c40008',
              en: 'Let First Move - Large Opposite Direction Cannons 008',
            },
            finalFen: '2bakab2/9/2N5n/p1p1p1p2/8p/P2R5/2P1P1P1P/1C2C4/7r1/1RBA1KBc1 w - - 0 1',
          },
          {
            id: 'g:9e6f0322b3d1768ae0e999af22449066',
            title: {
              zh: '\u8ba9\u5148-\u5c0f\u5217\u624b\u70ae\u5f03\u76f8\u9677\u8f66011',
              en: '011 Handicap Game: Small Opposite-Direction Cannon, Sacrifices an Elephant, and Traps a Chariot',
            },
            finalFen: '3akaRnr/r8/2n1b1cc1/p1p1p3p/9/9/P1P1P1P1P/NC2C1N2/9/R1BAKAB2 w - - 0 1',
          },
          {
            id: 'g:e64b754f5ebd11b45b2a88692341a033',
            title: {
              zh: '\u8ba9\u5148-\u5c0f\u5217\u624b\u7834\u5927\u5217\u624b\u70ae\u5c40009',
              en: '009 Handicap Game: Small Opposite-Direction Cannons Break a Large Opposite-Direction Cannon',
            },
            finalFen: '2bakab2/9/2R5n/pRp1p3p/9/P8/2P1P1P1P/N2CC4/4K2r1/2BA1Ncc1 w - - 0 1',
          },
          {
            id: 'g:abd3e59072f9b79c98da2ac6ac3c05a2',
            title: {
              zh: '\u8ba9\u5148-\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae012',
              en: 'Red to Move First: Screen Horse Defense Breaks Central Cannon 012',
            },
            finalFen: 'r1bak4/4a4/4b1n2/p7p/4r4/6P2/P1P1P3P/NC4N2/4A4/R1BAK3c w - - 0 1',
          },
          {
            id: 'g:bec819decc77b3da29f111203fc00276',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u593a\u5148001',
              en: 'Handicap Game - Same Direction Cannons, Ranked Chariot Breaking a Filed Chariot, Seizing the Initiative 001',
            },
            finalFen: '2bCkab2/9/6n2/2p1p1PRp/p8/9/P1P1N3P/N1n1c4/3rAr3/R1BAK1B2 w - - 0 1',
          },
          {
            id: 'g:1d16b90bb16c913eddd731ffde81a3ed',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u9a6c002',
              en: 'One-Move Handicap: Same Direction Cannons, Ranked Chariot Breaks Filed Chariot, Sacrificing the Horse 002',
            },
            finalFen: '1Cbakab2/9/9/p1p1p3p/9/9/P1P1R1P1P/N3C3B/4K2r1/1RBA1A2c w - - 0 1',
          },
          {
            id: 'g:f2b7fe8ea0435f6e8030cc0e08320c59',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u6c89\u70ae003',
              en: 'Handicap - Same Direction Cannons, Ranked Chariot Breaks Filed Chariot, Cannon-Sinking 003',
            },
            finalFen: '1rbakab2/2c6/2cr2n2/p3p2Rp/1n7/2R6/P1P1P1P1P/N2CC1N2/4A4/2BAK1B2 w - - 0 1',
          },
          {
            id: 'g:613e7b71152b4bc503c5e4a25ad555b0',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u5367\u69fd\u9a6c007',
              en: '007 Handicap Game: Same Direction Cannons, Filed Chariot, and a Horse at the Corner',
            },
            finalFen: '2bakab2/r8/4c1n2/p3p1R1p/2p6/6P2/P3P3P/N2AC1N2/R3K2r1/1cB2AB2 w - - 0 1',
          },
          {
            id: 'g:c901cdbbee67b5a3ccefac8eb5c2867a',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u5939\u9a6c\u70ae\u8d77\u76f8\u4fdd\u9a6c\u7834\u6a2a\u8f66006',
              en: 'Even Odds \u2014 Same Direction Cannons, Filed Chariot, Horse Cannon, Elephant Development, Horse Protection, Break the Ranked Chariot, 006',
            },
            finalFen: '2bakabr1/4n4/4c1n2/p3p1p1p/9/9/P3P1P1P/N1C1C1N2/4A4/c3KAB2 w - - 0 1',
          },
          {
            id: 'g:ce42a090fde3745e88be6ed821ecdf8d',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u5de1\u6cb3\u7834\u6a2a\u8f66005',
              en: 'Handicap Game - Same Direction Cannons, Filed Chariot, Riverbank Chariot Breaking the Ranked Chariot 005',
            },
            finalFen: 'r1b1kab2/4a4/4c1n2/2p1p1p1p/rR7/9/c1P1P1P1P/NC2C1N2/4A4/R1B1KAB2 w - - 0 1',
          },
          {
            id: 'g:2df55ecf8f2dc92ec3c63401dbc4632b',
            title: {
              zh: '\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66004',
              en: 'Even Odds \u2014 Same Direction Cannons, Filed Chariot Break the Ranked Chariot, 004',
            },
            finalFen: '2bakab2/1r7/n5n2/p1p1p1p1p/9/9/P3P1P1P/2CC2N2/1r2A4/RNBAK1B2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5de6\u9a6c',
          en: 'Black Gives the Left Horse',
        },
        games: [
          {
            id: 'g:cb679e5696b79e0e98c8be8efa5e7515',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u5148\u9a6c\u540e\u70ae\u6a2a\u8f66005',
              en: '005 Handicap Game: Left Horse First, Cannon Then Ranked Chariot',
            },
            finalFen: '2b1ka2r/4a4/4b3C/p1p1C1p1p/3R5/1r7/P1P1c1P1P/3R5/4A1c2/2BA1KB2 b - - 0 1',
          },
          {
            id: 'g:4e88201576d523bd1cf97c181947c220',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u5217\u624b\u70ae010',
              en: 'Handicap Left Horse - Opposite Direction Cannons 010',
            },
            finalFen: 'CR1rkabr1/4a4/b1n1c1c1n/p1p1C1p2/8p/3R5/P1P1P1P1P/4B1N2/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:fc484a85425c0f8d9d401685a8bc99e3',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u5217\u624b\u70ae\u7834\u5939\u9a6c009',
              en: 'Handicap Left Horse\u2014Opposite Direction Cannons Break the Sandwiched Horse 009',
            },
            finalFen: 'r2a1abnr/5c3/2n1Rk3/p1p3p1p/4C4/4C4/P1P1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:882775c3ff6cebaf6be2eea80b3ccb8a',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u6a2a\u8f66\u70ae\u7834\u58eb\u8c61\u53f3\u5355\u63d0\u9a6c006',
              en: 'Left Horse Handicap: Ranked Chariot and Cannon Break the Right Single Horse Defense 006',
            },
            finalFen: '1Ccrkab2/4a4/4b3n/p3C1p1p/7r1/9/P1P1P1P1P/3R2N2/4A4/2c1KAB2 b - - 0 1',
          },
          {
            id: 'g:3af63b8ba6229638f2dfc93a2ee8c59c',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u76f4\u8f66\u7834\u58eb\u8c61\u53f3\u5355\u63d0\u9a6c007',
              en: 'Handicap Left Horse - Filed Chariot Breaks the Advisor and Elephant, Right Single Horse Defense 007',
            },
            finalFen: '1R2kab2/2Nra4/2n2c2n/p1p3p1p/4r4/9/c1P3P1P/C3C4/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:239605063acac9acaf153c9f27f76236',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u987a\u70ae\u6a2a\u8f66\u7834\u4ed6\u5148\u4e0a\u9a6c002',
              en: 'Let Left Horse - Same Direction Cannons, Ranked Chariot Breaks the Opponent\u2019s First Horse 002',
            },
            finalFen: '1rb2kb2/4R3n/n4C1r1/2p2Cp1p/9/5c3/2P1P1P1P/6N2/4A4/2c1KAB2 b - - 0 1',
          },
          {
            id: 'g:d8c1989efec39830468def909e876a55',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u987a\u70ae\u6a2a\u8f66\u7834\u5148\u8865\u58eb\u89d2\u70ae003',
              en: 'Let Left Horse - Same Direction Cannons, Ranked Chariot Breaks the Advance and Supplemental Advisor\u2019s Corner Cannon 003',
            },
            finalFen: 'r1b1kab2/3Ra4/n3c4/p1p1C1p1p/9/9/P1P1P1P1P/4B1r2/4A4/3K1AB2 b - - 0 1',
          },
          {
            id: 'g:d05540bef7a2053c4285953cb8f9d79d',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u987a\u70ae\u6a2a\u8f66\u7834\u5939\u9a6c\u70ae004',
              en: 'Left Horse Handicap: Same Direction Cannons, Ranked Chariot Breaks Horse-Clipping Cannon 004',
            },
            finalFen: '2bnkab2/2N1a4/1c3cn2/p5p1p/4p4/9/P1P3r1P/2C1C4/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:c1797c40f3dba85ec44798628cf81804',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66001',
              en: 'Give Black the Move \u2014 Same Direction Cannons, Ranked Chariot, Break Filed Chariot 001',
            },
            finalFen: 'r1bak1b2/3RaR3/nc2C3n/p1p1p1p1p/9/9/P1P1r3P/4B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:064cfb05d46ca59115a51d7b89dcc05c',
            title: {
              zh: '\u8ba9\u5de6\u9a6c-\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66008',
              en: '008 Handicap Game: Left Horse, Same Direction Cannons, Filed Chariot Break Ranked Chariot',
            },
            finalFen: '1r1akab2/9/4b1R2/2prp3p/1n7/P8/2P1P1P1P/1R4N2/4A4/2BAK1B2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'jinpengshibabian',
    title: {
      zh: '\u91d1\u9e4f\u5341\u516b\u53d8',
      en: 'The 18 Stances of the Golden Roc',
    },
    chapters: [
      {
        title: {
          zh: '\u5f97\u5148',
          en: 'Red to Move',
        },
        games: [
          {
            id: 'g:68365b86aec51c1bd2540b9632b85ba7',
            title: {
              zh: 'N01\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u9a6c\u5c40',
              en: 'N01: Same Direction Cannons, Ranked Chariot Break the Filed Chariot, Horse Sacrifice Opening',
            },
            finalFen: 'r1bak1bn1/9/n3CR3/p1p1C1p1p/9/9/P1P1P1PrP/6N2/9/1cBAKAB2 b - - 0 1',
          },
          {
            id: 'g:cdd39384eea97ebe2d9f3ed25ca709ab',
            title: {
              zh: 'N02\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u4ed6\u5148\u4e0a\u9a6c\u5f03\u9a6c\u5c40',
              en: 'N02: Same Direction Cannons, Ranked Chariot Breaks Filed Chariot; He First Develops the Horse and Sacrifices It',
            },
            finalFen: '2bak2r1/3Ra4/2N3R2/2p3p1p/9/6P2/8P/4n4/4K4/1cBA1A3 b - - 0 1',
          },
          {
            id: 'g:eca62b42f49f1234a9450fba78184ca1',
            title: {
              zh: 'N03\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u9a6c\u4ed6\u4e0d\u6253\u5c40',
              en: 'N03 Same Direction Cannons, Ranked Chariot Breaks Filed Chariot, Sacrificed Horse; He Declines to Play',
            },
            finalFen: '1CC1k1b2/3ca4/b2a2n2/p3p1p1p/2p6/9/P1P1c3P/4K4/8r/1NBA1AB2 b - - 0 1',
          },
          {
            id: 'g:224dbb17bd61f35053786cfa3245393d',
            title: {
              zh: 'N04\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u8f66\u5c40',
              en: 'N04 Same Direction Cannons: Ranked Chariot Breaks Filed Chariot, Abandoned Chariot Line',
            },
            finalFen: 'r1b1kaC2/3Ra4/n2cn4/p7p/6p2/2P6/P3P3P/1r7/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:9de5c321b19a1cba2854392e08a58edb',
            title: {
              zh: 'N05\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u53cc\u8f66\u5c40',
              en: 'N05 Same Direction Cannons: Ranked Chariot Breaks Filed Chariot, Sacrificing Both Chariots',
            },
            finalFen: '1Cb1k1b2/4a4/r1c1c4/2p1C3p/9/2P2p3/4P3P/6r2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:f96db0eb97602d53a96f3ee9ec7f123b',
            title: {
              zh: 'N06\u987a\u70ae\u6a2a\u8f66\u7834\u80cc\u8865\u58eb\u5c40',
              en: 'N06 Same Direction Cannons, Ranked Chariot Breaks the Rear-Backing Advisor Formation',
            },
            finalFen: '1rbk2b2/1C2a1N2/n3c1n2/p1p1p1p1p/3R5/P8/2P1P1r1P/3C2N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:d8b2b112a72923b480b6d6b0ddf8db5b',
            title: {
              zh: 'N07\u987a\u70ae\u6a2a\u8f66\u7834\u8865\u58eb\u89d2\u70ae\u5c40',
              en: 'N07 Same Direction Cannons: Ranked Chariot Breaks Supplemental Palcorner Cannon',
            },
            finalFen: '2bak1br1/4a4/2ncc1n2/p1N1p3p/5rp2/P2R5/2P1P1P1P/2C1C1N2/9/1RBAKAB2 b - - 0 1',
          },
          {
            id: 'g:5e9452d6f3dc11df7490ec66f0ba5ed3',
            title: {
              zh: 'N08\u7a9d\u5fc3\u70ae\u7834\u8865\u58eb\u89d2\u70ae\u5c40',
              en: 'N08 Heart Cannon Breaks the Rear-Guard Palcorner Cannon Formation',
            },
            finalFen: '2bckabr1/9/2naC4/p1p1C1p1p/9/9/P1r1N1P1P/6N2/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:24bd94872e4c962ab42dfabac3307373',
            title: {
              zh: 'N09\u987a\u70ae\u6a2a\u8f66\u7834\u5939\u9a6c\u70ae',
              en: 'N09 Same Direction Cannons: Ranked Chariot Breaks Horse-Clipping Cannon',
            },
            finalFen: 'r1bakabr1/9/1c2c1n2/pCR3p1p/4p1n2/6P2/P1P1P3P/4C1N2/9/RNBAKAB2 b - - 0 1',
          },
          {
            id: 'g:ea4ebb6bc57bbb841a6a07f144e090e4',
            title: {
              zh: 'N10\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66\u5c40',
              en: 'N10 Same Direction Cannons: Filed Chariot Breaks Ranked Chariot Line',
            },
            finalFen: '2bR1k3/4ar3/nr2N4/p1p1C3p/3c5/9/P3P1P1P/B5N2/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:3200f9b6cf00f834bf1dc72ee203433d',
            title: {
              zh: 'N11\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66\u5939\u9a6c\u5c40',
              en: 'N11: Same Direction Cannons, Filed Chariot Breaks Ranked Chariot and Horse Formation',
            },
            finalFen: 'r1ba1kC2/4a1RCn/n1c1c4/p1p1p3p/9/9/P1P1P1P1P/2N6/3rN4/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:e4062c996b29b71fb2608bd18ee0d21f',
            title: {
              zh: 'N12\u987a\u70ae\u76f4\u8f66\u7834\u5de6\u5355\u63d0\u9a6c\u5c40',
              en: 'N12 Same Direction Cannons: Filed Chariot Breaks Left Single Horse Defense',
            },
            finalFen: 'r1bak2r1/4a1c2/nc2b1N2/p1p3R1p/4p1p2/9/P1P3P1P/1C2C1N2/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:778cbea382277ab230cd6ec7673baa61',
            title: {
              zh: 'N13\u987a\u5e73\u70ae\u7834\u53f3\u5355\u63d0\u9a6c\u58eb\u8c61\u5c40',
              en: 'N13 Same Direction Cannons Break the Right Single Horse Defense and Elephant Formation',
            },
            finalFen: 'C1bn1Rb1r/5k3/4N3n/2p3p1p/9/9/2Pr2P1P/2c1C4/9/c1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:f057e6bf4520d8ef79d0c5ae3a1255ad',
            title: {
              zh: 'N14\u987a\u70ae\u6a2a\u8f66\u7834\u8c61\u5c40',
              en: 'N14: Same Direction Cannons, Ranked Chariot Break the Elephant Formation',
            },
            finalFen: '1Ccrkab1r/4a4/4b3n/p3C1p1p/9/9/P1P1P1P1P/3R5/6c2/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:5688164a084142e9994820d2cca70566',
            title: {
              zh: 'N15\u70ae\u5c40\u7834\u8c61\u5c40',
              en: 'N15: Cannon Opening Breaks Elephant Opening',
            },
            finalFen: 'r3kCbr1/4aR3/1c2b2cn/p1p1C1p1p/6n2/9/P1P1P1P1P/6N2/9/RNBAKAB2 b - - 0 1',
          },
          {
            id: 'g:ef4cfd5cc162b084329bdf10aac4af58',
            title: {
              zh: 'N16\u5927\u5217\u624b\u70ae\u5c40',
              en: 'N16 Opposite Direction Cannons',
            },
            finalFen: '1Cb2Rb2/5k3/2c1c4/p3C1p2/2p2r1np/P8/2P1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:2ce53b722c1aaee7536b2ab814875f44',
            title: {
              zh: 'N17\u5c0f\u5217\u624b\u7834\u5927\u5217\u624b\u70ae\u5c40',
              en: 'N17 Small Opposite Direction Cannons Break the Large Opposite Direction Cannons',
            },
            finalFen: '2N2ab2/9/3Rk4/p7p/6r2/9/P1P1P3P/9/4A4/1NBAK2c1 b - - 0 1',
          },
          {
            id: 'g:4e6026a5cac66e3346513f97f623c99f',
            title: {
              zh: 'N18\u5217\u70ae\u7834\u58eb\u5148\u655b\u70ae',
              en: 'N18 Opposite-Direction Cannons Break the Advisor; First to Yield the Cannon',
            },
            finalFen: '6b1r/2R1Ckc2/4R3n/p1p3p1p/9/2P6/P3P1P1P/3r2N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:2378db5fbace55ce7b21bb4c1bdc60cc',
            title: {
              zh: 'N19\u5217\u70ae\u76f4\u8f66\u7834\u8865\u58eb\u89d2\u70ae\u5c40',
              en: 'N19 Opposite Direction Cannons, Filed Chariot Breaks the Palcorner Cannon',
            },
            finalFen: '1R1akab1r/2CR5/2n1cc2n/p1p1p3p/6p2/2P6/P3P1P1P/2r1C1N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:0a440b9aad3323f982bd8dbfa89170cb',
            title: {
              zh: 'N20\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u5c40',
              en: 'N20 Screen Horse Defense Against the Central Cannon',
            },
            finalFen: 'r1b2k3/4R4/n1c1c3b/p2R5/2p1p1p2/6P2/P1P1P3P/2N1B1r2/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:e2c6c990ec8f37c72326ef84b71767c6',
            title: {
              zh: 'N21\u987a\u70ae\u6a2a\u8f66\u7834\u6a2a\u8f66',
              en: 'N21 Same Direction Cannons: Ranked Chariot Breaks Ranked Chariot',
            },
            finalFen: 'r1bak1b2/4ar3/n3c1n2/2p1p1p1p/1c1R5/R8/2P1P1P1P/3CC1N2/4A4/1NB1KAB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u53cc\u9a6c',
          en: 'Black Gives Both Horses',
        },
        games: [
          {
            id: 'g:951b64b9f596119532327adefd7ce59b',
            title: {
              zh: 'N46\u8ba9\u53cc\u9a6c-\u5f97\u5148\u7834\u53f3\u5355\u63d0\u9a6c',
              en: 'N46 Handicap Game: Double Horses, First to Break the Right Single Horse Defense',
            },
            finalFen: '2bak3r/r3aR3/c1c1b4/p3C1p1p/2p6/9/P1P1P1P1P/9/9/1RBAKAB2 b - - 0 1',
          },
          {
            id: 'g:2955cedec745c66c790e44c3fa11deac',
            title: {
              zh: 'N47\u8ba9\u53cc\u9a6c-\u5f97\u5148\u7834\u5c4f\u98ce\u9a6c',
              en: 'N47 Handicap Double Horses - Gain the Initiative by Breaking the Screen Horse Defense',
            },
            finalFen: 'r1b1kaC2/4a4/1cn5c/p1p1p3p/9/9/P1P1P1P1P/9/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:6b75a652dc16555051bdae0b981a364b',
            title: {
              zh: 'N48\u8ba9\u53cc\u9a6c-\u5f97\u5148\u7834\u8c61\u5c40',
              en: 'N48: Even Odds \u2014 Double Horses Gain the Initiative and Break the Elephant Formation',
            },
            finalFen: 'r1ba1ab1r/5k3/nR5c1/p1p1C1p1p/9/9/P1P1C1P1P/9/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:eb0d07a6c24165302d0595e682279933',
            title: {
              zh: 'N49\u8ba9\u53cc\u9a6c-\u5f97\u5148\u987a\u70ae\u5c40',
              en: 'N49 Let Two Horses - Same Direction Cannons, First-Move Advantage',
            },
            finalFen: '3ak2r1/4a4/ncR1c1n1b/p3p1p1p/9/9/P2pP1P1P/1C7/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:7f01bcba0351152a58c51574948a366c',
            title: {
              zh: 'N50\u8ba9\u53cc\u9a6c-\u5f97\u5148\u7528\u70ae\u5c40',
              en: 'N50 Handicap Game: Double Horses \u2014 First to Use the Cannon',
            },
            finalFen: '1R4C2/4k2C1/3rc1n1r/p1p1p1p1p/9/9/P1P1c1P1P/9/9/2BAKAB1R b - - 0 1',
          },
          {
            id: 'g:297114b2cc148fa7b25fafa8160a27c0',
            title: {
              zh: 'N51\u8ba9\u53cc\u9a6c-\u7834\u6597\u5de1\u6cb3\u70ae',
              en: 'N51 Two-Horse Handicap: Break the River-Patrol Cannon',
            },
            finalFen: '2b1kabr1/4a4/2R1c3n/p1p1C1p1p/1c7/1C7/P1P1P1P1P/9/4A4/2BK1AB2 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5148',
          en: 'Black Gives the First Move',
        },
        games: [
          {
            id: 'g:8b84b2b3332c71f13538cee2de3b0b46',
            title: {
              zh: 'N22\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u593a\u5148',
              en: 'N22: Letting Red Move First \u2014 Same Direction Cannons, Ranked Chariot Breaks the Filed Chariot and Seizes the Initiative',
            },
            finalFen: '2bCkab2/9/6n2/2p1p1PRp/p8/9/P1P1N3P/N1n1c4/3rAr3/R1BAK1B2 w - - 0 1',
          },
          {
            id: 'g:eaf0f53cf75a2d1c0ae2b29a718379d3',
            title: {
              zh: 'N23\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u5f03\u9a6c\u5c40',
              en: 'N23: Even Odds \u2014 Same Direction Cannons, Ranked Chariot Breaks the Filed Chariot, Sacrificed Horse Formation',
            },
            finalFen: '1Cbakab2/9/9/p1p1p3p/9/9/P1P1R1P1P/N3C3B/4K2r1/1RBA1A2c w - - 0 1',
          },
          {
            id: 'g:6949b940ddee240c639527af6bfe0552',
            title: {
              zh: 'N24\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u7834\u76f4\u8f66\u6c89\u70ae\u5c40',
              en: 'N24: Even Odds \u2014 Same Direction Cannons, Ranked Chariot Breaks the Filed Chariot, Submerged Cannon Formation',
            },
            finalFen: '1rbakab2/2c6/2cr2n2/p3p2Rp/1n7/2R6/P1P1P1P1P/N2CC1N2/4A4/2BAK1B2 w - - 0 1',
          },
          {
            id: 'g:c279553d341484f7b5b92db41a1e6b3d',
            title: {
              zh: 'N25\u8ba9\u5148-\u5927\u5217\u624b\u70ae\u5c40',
              en: 'N25 One-Move Handicap: Opposite Direction Cannons',
            },
            finalFen: '2bakab2/9/2N5n/p1p1p1p2/8p/P2R5/2P1P1P1P/1C2C4/7r1/1RBA1KBc1 w - - 0 1',
          },
          {
            id: 'g:2c980e2a99c9d632632f004a6dd23df7',
            title: {
              zh: 'N26\u8ba9\u5148-\u5217\u624b\u70ae\u6c89\u70ae\u5c40',
              en: 'N26: Letting Red Move First \u2014 Opposite Direction Cannons, Cannon-Sinking Variation',
            },
            finalFen: '2baka2r/9/4b1n2/p7p/2p1c4/9/P1P3P1P/6N2/9/1NBAKAB2 w - - 0 1',
          },
          {
            id: 'g:d1fd911220389f63aaddee5dbbf4ea2f',
            title: {
              zh: 'N27\u8ba9\u5148-\u5c0f\u5217\u624b\u7834\u5927\u5217\u624b\u70ae\u76f4\u8f66\u5c40',
              en: 'N27 Give Red the Move \u2014 Small Opposite Direction Cannons Break Large Opposite Direction Cannons and a Filed Chariot Formation',
            },
            finalFen: '2bakab2/9/2R5n/pRp1p3p/9/P8/2P1P1P1P/N2CC4/4K2r1/2BA1Ncc1 w - - 0 1',
          },
          {
            id: 'g:2a0257474634c394c2cffb4b56737f82',
            title: {
              zh: 'N28\u8ba9\u5148-\u5c0f\u5217\u624b\u5c40',
              en: 'N28 Give Red the Move \u2014 Small Opposite Direction Cannons',
            },
            finalFen: '3akaRnr/r8/2n1b1cc1/p1p1p3p/9/9/P1P1P1P1P/NC2C1N2/9/R1BAKAB2 w - - 0 1',
          },
          {
            id: 'g:164495c2e25f60da835260b303658f67',
            title: {
              zh: 'N29\u8ba9\u5148-\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u5c40',
              en: 'N29 Give Red the Move \u2014 Screen Horse Defense Breaks the Central Cannon Formation',
            },
            finalFen: 'r1bak4/4a4/4b1n2/p7p/4r4/6P2/P1P1P3P/NC4N2/4A4/R1BAK3c w - - 0 1',
          },
          {
            id: 'g:6cea82ba3a9b505cfb0641e018c994ad',
            title: {
              zh: 'N30\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u5939\u9a6c\u8d77\u76f8\u4fdd\u9a6c\u80dc\u8f66\u5c40',
              en: 'N30 Handicap - Same Direction Cannons, Filed Chariot Flanks the Horse, Begins the Elephant, Protects the Horse, Wins the Chariot Game',
            },
            finalFen: '2bakabr1/4n4/4c1n2/p3p1p1p/9/9/P3P1P1P/N1C1C1N2/4A4/c3KAB2 w - - 0 1',
          },
          {
            id: 'g:6de5cf9e3935260587dbe99dace4da69',
            title: {
              zh: 'N31\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66\u5de1\u6cb3\u8f66\u5c40',
              en: 'N31 Handicap Game - Same Direction Cannons, Filed Chariot, Breaking the Ranked Chariot, Riverbank Chariot',
            },
            finalFen: 'r1b1kab2/4a4/4c1n2/2p1p1p1p/rR7/9/c1P1P1P1P/NC2C1N2/4A4/R1B1KAB2 w - - 0 1',
          },
          {
            id: 'g:ac6812c74371229e61b7d7247afd46c9',
            title: {
              zh: 'N32\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66',
              en: 'N32: Letting Red Move First \u2014 Same Direction Cannons, Filed Chariot Breaks the Ranked Chariot',
            },
            finalFen: '2bakab2/1r7/n5n2/p1p1p1p1p/9/9/P3P1P1P/2CC2N2/1r2A4/RNBAK1B2 w - - 0 1',
          },
          {
            id: 'g:0a6b3b630ce157f9fcfb118a2ea918bd',
            title: {
              zh: 'N33\u8ba9\u5148-\u987a\u70ae\u76f4\u8f66\u5367\u69fd\u9a6c\u5c40',
              en: 'N33: Even Odds \u2014 Same Direction Cannons, Filed Chariot, and Cramped Horse Formation',
            },
            finalFen: '2bakab2/r8/4c1n2/p3p1R1p/2p6/6P2/P3P3P/N2AC1N2/R3K2r1/1cB2AB2 w - - 0 1',
          },
          {
            id: 'g:adefc5d616b2d11a48da96ce287d0346',
            title: {
              zh: 'N34\u8ba9\u5148-\u70ae\u7834\u8c61\u7f20\u89d2\u9a6c\u5c40',
              en: 'N34 Handicap Game\u2014Cannon Breaks the Elephant-Entangled Corner Horse Line',
            },
            finalFen: 'r1bakab2/1R7/6n2/p1p3p1p/9/4N4/P1P3P2/NC3A3/9/1R1AKn1rc w - - 0 1',
          },
          {
            id: 'g:2626cf94ce04d7f5be76cad0e11ab649',
            title: {
              zh: 'N35\u8ba9\u5148-\u987a\u70ae\u6a2a\u8f66\u593a\u5148\u5c40',
              en: 'N35 Handicap - Same Direction Cannons, Ranked Chariot Seizes the Initiative',
            },
            finalFen: 'r2akab2/3r5/b3c1n2/p3p3p/9/2R3P2/P1P1P3P/1Cn1C1N2/9/1RBAKAB2 w - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5de6\u9a6c',
          en: 'Black Gives the Left Horse',
        },
        games: [
          {
            id: 'g:67b2754d1f29ac067952bdb41f973bf6',
            title: {
              zh: 'N36\u8ba9\u5de6\u9a6c-\u5f97\u5148\u987a\u624b\u70ae\u5c40',
              en: 'N36 Handicap Left Horse - Gain the Initiative in Same Direction Cannons',
            },
            finalFen: 'r1bak1b2/3RaR3/nc2C3n/p1p1p1p1p/9/9/P1P1r3P/4B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:aa1295bdfb23646bebc9d0d840e6602d',
            title: {
              zh: 'N37\u8ba9\u5de6\u9a6c-\u987a\u624b\u70ae\u7834\u4ed6\u5148\u4e0a\u9a6c\u5c40',
              en: 'N37: Letting Red\u2019s Left Horse \u2014 Same Direction Cannons Break Through Against a Horse Opening',
            },
            finalFen: '1rb2kb2/4R3n/n4C1r1/2p2Cp1p/9/5c3/2P1P1P1P/6N2/4A4/2c1KAB2 b - - 0 1',
          },
          {
            id: 'g:db1c61d8efba7ce0fe249ff2ea5b8dcc',
            title: {
              zh: 'N38\u8ba9\u5de6\u9a6c-\u5f97\u5148\u7834\u8865\u58eb\u89d2\u70ae',
              en: 'N38: Let the Left Horse Move First; Break the Palcorner Cannon',
            },
            finalFen: 'r1b1kab2/3Ra4/n3c4/p1p1C1p1p/9/9/P1P1P1P1P/4B1r2/4A4/3K1AB2 b - - 0 1',
          },
          {
            id: 'g:f7332aef6ac8c3ed3cab4d5d0e543ce5',
            title: {
              zh: 'N39\u8ba9\u5de6\u9a6c-\u7834\u5939\u9a6c\u5217\u58eb\u89d2\u70ae\u5c40',
              en: 'N39: Even Odds \u2014 Left Horse Breaks the Flank Horse, Opposite Direction Cannons, Palcorner Cannon Formation',
            },
            finalFen: '2bnkab2/2N1a4/1c3cn2/p5p1p/4p4/9/P1P3r1P/2C1C4/9/R1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:342f689acc5d6b774cd7d2dbd035906a',
            title: {
              zh: 'N40\u8ba9\u5de6\u9a6c-\u5f97\u5148\u7528\u9a6c\u5c40',
              en: 'N40 Handicap Left Horse - Gaining the Initiative with Horse Play',
            },
            finalFen: '2b1ka2r/4a4/4b3C/p1p1C1p1p/3R5/1r7/P1P1c1P1P/3R5/4A1c2/2BA1KB2 b - - 0 1',
          },
          {
            id: 'g:607c454d026ab6a790eaa725d6b10fa0',
            title: {
              zh: 'N41\u8ba9\u5de6\u9a6c-\u5f97\u5148\u987a\u70ae\u6a2a\u8f66\u7834\u5355\u63d0\u9a6c\u5c40',
              en: 'N41 Handicap Game: Left Horse, Same Direction Cannons, and a Filed Chariot Break the Single Horse Defense',
            },
            finalFen: '1Ccrkab2/4a4/4b3n/p3C1p1p/7r1/9/P1P1P1P1P/3R2N2/4A4/2c1KAB2 b - - 0 1',
          },
          {
            id: 'g:1b31d481f3fda207995efcf6395ff2b9',
            title: {
              zh: 'N42\u8ba9\u5de6\u9a6c-\u5f97\u5148\u76f4\u8f66\u7834\u5355\u63d0\u9a6c\u5c40',
              en: 'N42: Let the Left Horse Move First; Filed Chariot Breaks the Single Horse Defense',
            },
            finalFen: '1R2kab2/2Nra4/2n2c2n/p1p3p1p/4r4/9/c1P3P1P/C3C4/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:3334d4b5bc07dca4bb53b6606bdea129',
            title: {
              zh: 'N43\u8ba9\u5de6\u9a6c-\u7834\u5217\u624b\u70ae\u5939\u9a6c\u5c40',
              en: 'N43 Handicap Left Horse - Breaking Opposite Direction Cannons, Horse-Pinching Formation',
            },
            finalFen: 'r2a1abnr/5c3/2n1Rk3/p1p3p1p/4C4/4C4/P1P1P1P1P/6N2/9/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:b3c850996537181ebee9cbad12049a9c',
            title: {
              zh: 'N44\u8ba9\u5de6\u9a6c-\u5f97\u5148\u5217\u624b\u70ae',
              en: 'N44 Handicap Game: Left Horse, First to Move, Opposite-Direction Cannon',
            },
            finalFen: 'CR1rkabr1/4a4/b1n1c1c1n/p1p1C1p2/8p/3R5/P1P1P1P1P/4B1N2/9/3AKAB2 b - - 0 1',
          },
          {
            id: 'g:fe18943276d52bbb879c7496b686ea43',
            title: {
              zh: 'N45\u8ba9\u5de6\u9a6c-\u76f4\u8f66\u7834\u987a\u624b\u70ae\u5c40',
              en: 'N45 Give Black the Move \u2014 Filed Chariot Breaks Same Direction Cannons',
            },
            finalFen: '1r1akab2/9/4b1R2/2prp3p/1n7/P8/2P1P1P1P/1R4N2/4A4/2BAK1B2 b - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'fanmeihuapu',
    title: {
      zh: '\u53cd\u6885\u82b1\u8c31',
      en: 'Anti-Plum Flower Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u53cd\u6885\u82b1\u8c31',
          en: 'Anti-Plum Flower Manual',
        },
        games: [
          {
            id: 'g:b9d24c873ee6ba6433070c3f0ceaadb9',
            title: {
              zh: '\u7b2c1\u5c40 \u5f53\u5934\u70ae\u76f4\u8f66\u7834\u5c4f\u98ce\u9a6c\u5c40',
              en: 'Game 1: Central Cannon, Filed Chariot, Breaks Screen Horse Defense',
            },
            finalFen: '1Cr1kabr1/2c1a4/2c1b4/p2P4p/5np2/9/P5P1P/2N1C1N2/9/1RBAKAB2 b - - 0 1',
          },
          {
            id: 'g:252c928076126ef20e771ea40de836ea',
            title: {
              zh: '\u7b2c2\u5c40 \u5f53\u5934\u70ae\u7834\u5c4f\u98ce\u9a6c\u8d77\u7740\u8fdb\u5175\u5c40',
              en: 'Game 2: Central Cannon Breaks Screen Horse; Opening Pawn Advance',
            },
            finalFen: '2baka3/5n3/4b4/p7p/2p1p1r2/9/P7n/4N1R2/4KC3/2BA1A3 w - - 0 1',
          },
          {
            id: 'g:1bc7abd402d8f2fa8dfe05aad90d4a65',
            title: {
              zh: '\u7b2c3\u5c40 \u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66\u5c40',
              en: 'Game 3: Same Direction Cannons, Filed Chariot Breaks Ranked Chariot Line',
            },
            finalFen: '2bakab2/4n4/2nR5/p1p1p1p1p/9/6P2/c7P/NC1KC1NcB/4A4/2r2A3 w - - 0 1',
          },
          {
            id: 'g:8d5ad8923ab296621d4a2f1dac6b3d1b',
            title: {
              zh: '\u7b2c4\u5c40 \u8f6f\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u5c40',
              en: 'Game 4: Soft Screen Horse Breaks the Central Cannon Line',
            },
            finalFen: '2bak4/4a4/4c4/p1p5p/9/3n5/P1P1P2nP/2N1B1r2/R4C3/2BAKA1C1 w - - 0 1',
          },
          {
            id: 'g:85481259be77a20ac140b1455d9d9818',
            title: {
              zh: '\u7b2c5\u5c40 \u6a2a\u8f66\u9f9f\u80cc\u70ae\u7834\u5f53\u5934\u70ae\u5c4f\u98ce\u9a6c\u5c40',
              en: 'Game 5: Ranked Chariot, Turtle Back Cannons, Breaking Central Cannon and Screen Horse',
            },
            finalFen: '3ak1b2/4acN2/3cR4/p4R2p/9/9/P5P1P/4B4/4r2n1/5KB2 w - - 0 1',
          },
          {
            id: 'g:62da789ef93595dbde26b96c84a98158',
            title: {
              zh: '\u7b2c6\u5c40 \u6a2a\u8f66\u9f9f\u80cc\u70ae\u7834\u5f53\u5934\u70ae\u5c40',
              en: 'Game 6: Ranked Chariot and Turtle Back Cannons Break the Central Cannon Opening',
            },
            finalFen: '3a1kb2/1N2ac3/4b4/3N2p1p/P4R3/3p5/3np1P1P/4K4/9/2Br2B2 w - - 0 1',
          },
          {
            id: 'g:fdbe5eaf83aeff492978083b8eadffce',
            title: {
              zh: '\u7b2c7\u5c40 \u6a2a\u8f66\u8c61\u6539\u8f6c\u70ae\u7834\u5f53\u5934\u70ae\u5c40',
              en: 'Game 7: Ranked Chariot and Elephant Shift to a Cannon to Break the Central Cannon Line',
            },
            finalFen: '1nb1kab2/4a4/6rc1/pCp3NRp/1r7/9/P1P2nP1P/4BAN2/9/R3KAB2 w - - 0 1',
          },
          {
            id: 'g:47e258951a80fc2711f53caa8be6198b',
            title: {
              zh: '\u7b2c8\u5c40 \u6a2a\u8f66\u7834\u76f4\u8f66\u58eb\u76f8\u5c40',
              en: 'Game 8: Ranked Chariot Breaks the Filed Chariot and Advisor-Elephant Formation',
            },
            finalFen: '1r1akab2/9/4b4/p3p3p/7c1/3R2B2/P3P1n1P/1c5C1/4A1N2/2BAK4 w - - 0 1',
          },
        ],
      },
    ],
  },
  {
    slug: 'chongbentang',
    title: {
      zh: '\u5d07\u672c\u5802\u6885\u82b1\u8c31',
      en: 'Chong Ben Tang Plum Flower Manual',
    },
    chapters: [
      {
        title: {
          zh: '\u5f97\u5148',
          en: 'Red to Move',
        },
        games: [
          {
            id: 'g:7dd5e326cf63982bf4f57d82bf7b97f6',
            title: {
              zh: '\u5217\u624b\u70ae\u5c40',
              en: 'Opposite Direction Cannons',
            },
            finalFen: '4k4/n3R4/b3N3b/p8/2pP4p/5nN2/P2r4P/9/4C4/1cBAKAB2 b - - 0 1',
          },
          {
            id: 'g:3d7077b2e56202ce4a42aa280c1da56f',
            title: {
              zh: '\u6a2a\u8f66\u5939\u9a6c\u70ae\u7834\u5355\u63d0\u9a6c',
              en: 'Ranked Chariot and Horse-Clipping Cannon Break Single Horse Defense',
            },
            finalFen: '1r1a1kr2/9/C2c1an2/p1p3p1p/4p4/9/P1P3P1P/2N1C4/5R3/1RBAKABc1 b - - 0 1',
          },
          {
            id: 'g:3e5b83ed7c670226db486b9cfcff5bd6',
            title: {
              zh: '\u6a2a\u8f66\u7834\u53f3\u8f66\u5355\u63d0\u9a6c\u5c40',
              en: 'Ranked Chariot Breaks Right Chariot, Single Horse Defense',
            },
            finalFen: '3k1ab2/1N2ac3/4b4/p2R2p2/4C3p/4r4/P5n1P/B5N2/4A4/1c2KAB2 b - - 0 1',
          },
          {
            id: 'g:569281ef75f4a3eed825fc538ed47fcc',
            title: {
              zh: '\u6a2a\u8f66\u9e33\u9e2f\u9a6c\u7834\u53f3\u5355\u63d0\u9a6c',
              en: 'Ranked Chariot and Twin Horses Break the Right Single Horse Defense',
            },
            finalFen: '5a1r1/3R5/2Ck1N2n/p1p3p1p/9/5p3/P1P3P1P/9/9/c1BAKAB2 b - - 0 1',
          },
          {
            id: 'g:903a1995a5508a06fe9250ec345de18e',
            title: {
              zh: '\u76f4\u8f66\u5bf9\u76f4\u8f66\u5c40\uff08\u8d77\u9a6c\uff0d\u4e2d\u70ae\uff09',
              en: 'Filed Chariot vs. Filed Chariot Variation (Horse Opening\u2014Central Cannon)',
            },
            finalFen: '1rba5/4an3/3c1k3/p8/4N4/2P6/P3C3P/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:059bd9e378360b420772da87f24b7c86',
            title: {
              zh: '\u76f4\u8f66\u7834\u5355\u63d0\u9a6c\u5c40',
              en: 'Filed Chariot Breaks Single Horse Defense',
            },
            finalFen: '1rba1kb2/1C2a4/n2c2N1c/p1p1C4/4P4/6p2/P1r5P/2N1B4/4An3/1R2KAB2 b - - 0 1',
          },
          {
            id: 'g:e7df076927a11ad9a518e3dcbd4170d1',
            title: {
              zh: '\u76f4\u8f66\u9a6c\u70ae\u5c40',
              en: 'Filed Chariot, Horse, and Cannon Formation',
            },
            finalFen: '1Rb1ka1r1/3C5/2N1ba2n/p5p1p/2p1r4/9/P1P3P1P/9/4A4/2B1KAB2 b - - 0 1',
          },
          {
            id: 'g:b8033f95838eb7e42b582d79d1c774f7',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u7834\u58eb\u89d2\u70ae',
              en: 'Same Direction Cannons, Ranked Chariot Breaks the Advisor\u2019s Corner Cannon',
            },
            finalFen: '2bkRa3/9/nr1cb4/p1p1C3p/5np2/3r5/P3P1P1P/6N2/7R1/2BAKAB2 b - - 0 1',
          },
          {
            id: 'g:1f451f0322c74146d739845eb11c6e43',
            title: {
              zh: '\u987a\u70ae\u76f4\u8f66\u7834\u6a2a\u8f66',
              en: 'Same Direction Cannons, Filed Chariot Breaks the Ranked Chariot',
            },
            finalFen: '3R1Rb2/r1cCk4/b3c4/p1p1p3p/4n4/9/P1P1P1n1P/N3B1N2/3rA4/2BA1K3 b - - 0 1',
          },
        ],
      },
      {
        title: {
          zh: '\u8ba9\u5148',
          en: 'Black Gives the First Move',
        },
        games: [
          {
            id: 'g:0b8937c47dcc37a63a6611df23c21d1f',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u53d8\u8fb9\u9a6c\u5c40',
              en: 'Screen Horse Defense Becomes Edge Horse Formation',
            },
            finalFen: '4kab2/4a4/2n1b4/p7p/2p1c4/9/P1P3r1P/4C4/3rA2R1/R1BNK4 w - - 0 1',
          },
          {
            id: 'g:206c492bb2a3ba53218f819643f03b8a',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u5c40',
              en: 'Screen Horse Defense',
            },
            finalFen: '3k1ab2/4a4/4b4/p1p1R3p/6p2/2P1P4/P7P/BCN5N/8r/R3Kc1r1 w - - 0 1',
          },
          {
            id: 'g:cd53bb1eac87d46d450b1c38344d3cd5',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u76f4\u8f66\u5c40',
              en: 'Screen Horse Defense, Filed Chariot Opening',
            },
            finalFen: '2bak4/4a4/4b1n2/p4r2p/7c1/6P2/P1P1P3P/1CN1NA1R1/1r7/2BAK3c w - - 0 1',
          },
          {
            id: 'g:d4472da811d06c55cee0c8e387f64346',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u76f4\u8f66\u7834\u76f4\u8f66',
              en: 'Screen Horse Defense Breaks a Filed Chariot',
            },
            finalFen: '3akab1c/2r6/4b1R2/p7p/9/9/8P/4BK3/9/3A1A3 w - - 0 1',
          },
          {
            id: 'g:a40425c59815b7cedabb3e75a6509438',
            title: {
              zh: '\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae',
              en: 'Screen Horse Defense Against the Central Cannon',
            },
            finalFen: 'r3kabr1/1c2a4/4b4/p2R2R2/2p3n2/5p3/P1P3P1P/1Cc1B4/4A4/4KAB2 w - - 0 1',
          },
          {
            id: 'g:ef43eda2a8f72c3f678dc90a707158b3',
            title: {
              zh: '\u8ba9\u4e09\u5148\u5c4f\u98ce\u9a6c\u7834\u5f53\u5934\u70ae\u53bb\u9a6c\u5c40',
              en: 'Give Three Moves to Red \u2014 Screen Horse Defense Breaks the Central Cannon and Releases the Horse',
            },
            finalFen: '5ab2/1R2a4/2Ck5/8p/2b3p2/9/P3n3P/6R2/4A4/2BA1K1cc w - - 0 1',
          },
          {
            id: 'g:ccd645395695e3141429024ab025a58b',
            title: {
              zh: '\u8ba9\u53cc\u5148\u987a\u70ae\u4e3a\u58eb\u89d2\u70ae\u5c40',
              en: 'Even Odds \u2014 Same Direction Cannons Become Palcorner Cannons',
            },
            finalFen: '2ba1k3/4a4/3Cb4/p7p/2p6/6P2/P1PR4P/3KB4/4r1n1c/R1B6 w - - 0 1',
          },
          {
            id: 'g:81565dd772d7bbe8d246bf544d3e4f66',
            title: {
              zh: '\u8ba9\u5de6\u9a6c\u5f97\u5148\u6a2a\u8f66\u987a\u70ae\u5c40',
              en: 'Let Left Horse With First Move, Ranked Chariot Same Direction Cannons',
            },
            finalFen: '1r1cka1cC/7R1/b8/p5R1p/2p6/9/P1P1r3P/4B4/4A4/4KAB2 b - - 0 1',
          },
          {
            id: 'g:1bbcca5c52b5d49a5b3d387dd460d095',
            title: {
              zh: '\u8ba9\u5de6\u9a6c\u5f97\u5148\u987a\u70ae\u6a2a\u8f66\u7834\u58eb\u89d2\u70ae\u5c40',
              en: 'Let Left Horse With First Move, Same Direction Cannons, Ranked Chariot Breaks the Palcorner Cannon',
            },
            finalFen: '2Cak1b2/4a4/4c4/4p3p/5np2/9/P1P1P1r1P/4B1N2/3R5/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:bd4cc21334ab49c7f32fba0169e59cbe',
            title: {
              zh: '\u8ba9\u5de6\u9a6c\u5f97\u5148\u987a\u70ae\u76f4\u8f66\u5c40',
              en: 'Handicap Left Horse Gains the Initiative in the Filed Chariot Opening',
            },
            finalFen: '2Rcka3/4a4/2NcR4/6r2/9/6P2/1p2P3P/4B4/9/2BAKA3 b - - 0 1',
          },
          {
            id: 'g:e92fbe5d70248b39ec33411e731f0480',
            title: {
              zh: '\u987a\u70ae\u6a2a\u8f66\u53d8\u53e0\u70ae\u5c40',
              en: 'Same Direction Cannons, Ranked Chariot Transposes into Tandem Cannons',
            },
            finalFen: 'r3kab2/2c1a4/2n1b1n2/8p/p3p4/2P6/P4RP1P/N3C1N2/3rA4/2BCKAB2 w - - 0 1',
          },
        ],
      },
    ],
  },
];
