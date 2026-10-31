"""Source-specific parsers. A changed publication format fails before import."""
from __future__ import annotations

import io
import re
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

WXF_PAGE = 'https://www.wxf-xiangqi.org/index.php?Itemid=320&id=223&lang=en&option=com_content&view=article'
QIPU_PAGE = 'https://www.xiangqiqipu.com/Player/'
CXA_PAGE = 'https://www.sport.gov.cn/qpzx/n5384/c24089157/content.html'
CXA_PDF = 'https://www.sport.gov.cn/qpzx/n5384/c24089157/part/24089167.pdf'
CXA_NOTICES = 'https://www.sport.gov.cn/qpzx/n5384/index.html'
# Reviewed official notices (the 2025 association text is reproduced by CCTV).
# Explicit publication manifests keep proposals, other sports and mere bans out.
TITLE_NOTICES = [
    ('2024-09-19', 'https://www.sport.gov.cn/n20001280/n20067662/n20067613/c28114979/content.html',
     ['王天一', '王跃飞']),
    ('2025-01-12', 'https://news.cctv.com/2025/01/12/ARTItQMqk1JC9ADYpYh09eKh250112.shtml',
     ['赵鑫鑫', '汪洋', '郑惟桐', '王廓', '孙逸阳', '赵金成', '张申宏', '刘俊达', '俞易肖', '孙勇征', '程鸣', '郝继超']),
    ('2026-04-13', 'https://www.sport.gov.cn/n20001280/n20067662/n20067613/c29534486/content.html',
     ['洪智', '谢靖', '徐超', '申鹏', '蒋川']),
]


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def all(self, tag=None, css=None):
        for child in self.children:
            if isinstance(child, Node):
                if (not tag or child.tag == tag) and (not css or css in child.attrs.get('class', '').split()):
                    yield child
                yield from child.all(tag, css)

    def text(self):
        return ' '.join(' '.join(c.text() if isinstance(c, Node) else c for c in self.children).split())


class Html(HTMLParser):
    def __init__(self, data):
        super().__init__()
        self.root = Node()
        self.stack = [self.root]
        self.feed(data.decode('utf-8-sig'))

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'wbr'}:
            self.stack.append(node)

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def pdf_text(data):
    from pypdf import PdfReader
    pdf = PdfReader(io.BytesIO(data))
    if not 1 <= len(pdf.pages) <= 100:
        raise ValueError('Unexpected title publication size')
    return '\n'.join(p.extract_text(extraction_mode='layout') for p in pdf.pages)


def publication(provider, url, date, evidence):
    return dict(provider=provider, url=url, publishedAt=date, observedAt=evidence['observedAt'],
                sha256=evidence['sha256'])


def wxf_publication(data):
    links = {urljoin(WXF_PAGE, n.attrs['href']) for n in Html(data).root.all('a') if n.attrs.get('href')}
    links = [u for u in links if re.fullmatch(r'https://www\.wxf-xiangqi\.org/images/Player_Titled_List/[^?#]+\.pdf', u)]
    if len(links) != 1:
        raise ValueError(f'Expected one WXF title roster, found {len(links)}')
    date = re.search(r'20\d{6}', links[0])
    if not date:
        raise ValueError('Missing WXF publication date')
    d = date[0]
    return links[0], f'{d[:4]}-{d[4:6]}-{d[6:]}'


COUNTRIES = {'The United States of America': 'USA', 'Hong Kong, China': 'HKG', 'Chinese Taipei': 'TPE',
             'The Netherlands': 'NED', 'The Philippines': 'PHI', 'Macau, China': 'MAC', 'Great Britain': 'GBR',
             'Singapore': 'SGP', 'Australia': 'AUS', 'Indonesia': 'INA', 'Malaysia': 'MAS', 'Cambodia': 'CAM',
             'Thailand': 'THA', 'Vietnam': 'VIE', 'Germany': 'GER', 'Finland': 'FIN', 'Sweden': 'SWE',
             'Belarus': 'BLR', 'Myanmar': 'MYA', 'Brunei': 'BRU', 'Canada': 'CAN', 'France': 'FRA',
             'Italy': 'ITA', 'Spain': 'ESP', 'Japan': 'JPN', 'China': 'CHN', 'Russia': 'RUS',
             'Poland': 'POL', 'Denmark': 'DEN', 'Austria': 'AUT', 'Switzerland': 'SUI', 'Belgium': 'BEL'}


def wxf(text, pub):
    starts = list(re.finditer(r'(?m)^\s*(IGM|IFM|IM)(\d{4})\s+', text))
    if not starts or len(starts) != len(re.findall(r'(?m)^\s*(?:IGM|IFM|IM)', text)):
        raise ValueError('Malformed WXF identifiers')
    records = []
    for i, match in enumerate(starts):
        content = ' '.join(text[match.end():starts[i+1].start() if i+1 < len(starts) else len(text)].split())
        details = re.match(r'(.+?)\s*[男女]\s+(Male|Female)\s+(.+)', content)
        if not details:
            raise ValueError(f'Malformed WXF row: {match[0]}')
        country_name = re.sub(r'^[^A-Za-z]+', '', details[1])
        country = next((c for c in sorted(COUNTRIES, key=len, reverse=True) if country_name.startswith(c)), None)
        if not country:
            raise ValueError(f'Unknown WXF country: {country_name}')
        names = re.fullmatch(r'([^A-Za-z]+?)\s*([A-Za-z].*)', country_name[len(country):].strip())
        code = match[1]
        expected = {'IGM': 'International Grandmaster', 'IM': 'International Master', 'IFM': 'Federation Master'}[code]
        if not names or expected not in details[3]:
            raise ValueError(f'Invalid WXF name/title: {match[0]}')
        records.append(dict(provider='wxf', externalId=code+match[2], nativeName=names[1].strip(),
                            name=names[2].strip(), gender='M' if details[2]=='Male' else 'F', fed=COUNTRIES[country],
                            titles=[dict(issuer='WXF', code=code, label=expected, status='recorded', source=pub)], source=pub))
    if len({r['externalId'] for r in records}) != len(records):
        raise ValueError('Duplicate WXF ID')
    return records


def cxa(text, pub):
    if '协会等级称号' not in text or '2022年度象棋运动员注册名单' not in text:
        raise ValueError('Unrecognized CXA registration publication')
    records, serials = [], []
    for line in text.splitlines():
        match = re.match(r'^\s*(\d+)\s*([\u3400-\u9fff·]+)\s+([男女])\s+\S+\s+(.+)', line)
        if not match:
            continue
        serial, name, gender, rest = match.groups()
        serials.append(int(serial))
        # Only the explicit association title column, never athlete grades.
        title = re.search(r'(特级大师|国家大师|棋协大师|地方大师)', rest)
        team = re.split(r'\s{2,}|国际级运动健将|运动健将|[一二三]级运动员|特级大师|国家大师|棋协大师|地方大师', rest)[0].strip()
        fields = dict(provider='cxa', externalId=pub['publishedAt']+':'+serial, nativeName=name,
                      name=name, gender='M' if gender=='男' else 'F', team=team, teamAsOf=pub['publishedAt'], source=pub)
        if title:
            label = title[1]
            fields['titles'] = [dict(issuer='CXA', code={'特级大师':'GM','国家大师':'NM','棋协大师':'CAM','地方大师':'LM'}[label],
                                    label=label, status='recorded', source=pub)]
        records.append(fields)
    if serials != list(range(1, 936)):
        raise ValueError(f'CXA 2022 roster expected rows 1–935; parsed {len(serials)}')
    return records


def qipu_directory(data):
    root = Html(data).root
    records = {}
    tables = list(root.all('table'))
    if len(tables) != 2:
        raise ValueError('Expected male and female Xiangqiqipu directories')
    for table_index, table in enumerate(tables):
        for row in table.all('tr'):
            cells = list(row.all('td'))
            if len(cells) != 7:
                continue
            links = [a for a in cells[1].all('a') if re.fullmatch(r'/Player/View-\d+\.html', a.attrs.get('href',''))]
            if len(links) != 1:
                raise ValueError('Unrecognized Xiangqiqipu player row')
            link = links[0]
            identifier = re.search(r'View-(\d+)', link.attrs['href'])[1]
            name = link.text()
            date = cells[3].text()
            birth = re.fullmatch(r'(\d{4})年(?:(\d{2})月(?:(\d{2})日)?)?', date)
            record = dict(provider='xiangqiqipu', externalId=identifier, nativeName=name, name=name,
                          gender='M' if table_index == 0 else 'F',
                          birthplace=cells[2].text(), claimedTitle=cells[4].text(),
                          profileUrl=urljoin(QIPU_PAGE,link.attrs['href']))
            if birth:
                record['year'] = int(birth[1])
                record['birthDate'] = '-'.join(p for p in birth.groups() if p)
            if identifier in records:
                raise ValueError('Duplicate Xiangqiqipu profile ID')
            records[identifier] = record
    if len(records) < 100:
        raise ValueError(f'Incomplete Xiangqiqipu directory: {len(records)}')
    return list(records.values())


def qipu_profile(data, record, pub):
    root = Html(data).root
    headings = list(root.all('h1'))
    if len(headings) != 1 or headings[0].text() != record['nativeName']:
        raise ValueError(f'Xiangqiqipu identity mismatch: {record["externalId"]}')
    description = next(root.all(css='view-desc'), None)
    if description is None:
        raise ValueError('Missing Xiangqiqipu biography container')
    result = {**record, 'source':pub}
    result['fieldSources'] = {field:record['directorySource'] for field in
                             ('name','gender','year','birthDate','birthplace') if field in record}
    portraits = list(description.all('img'))
    portrait_src = portraits[0].attrs.get('src','') if portraits else ''
    if portrait_src and urlsplit(urljoin(QIPU_PAGE, portrait_src)).path.strip('/'):
        result['photoCandidate'] = dict(url=urljoin(QIPU_PAGE,portrait_src), sourceUrl=pub['url'],
                                        status='permission-required')
    # Original factual summaries from structured fields; never republish prose.
    name = record['nativeName']
    en, zh = f'{name} is a xiangqi player.', f'{name}，象棋棋手。'
    if record.get('year'):
        en += f' Born in {record["year"]}.'
        zh += f'生于{record["year"]}年。'
    if record.get('birthplace'):
        en += f' Listed place of origin: {record["birthplace"]}.'
        zh += f'资料记载籍贯为{record["birthplace"]}。'
    result['biography'] = {'en':en, 'zh-CN':zh}
    result['biographySources'] = [QIPU_PAGE,pub['url']]
    return result


def title_notice(data, pub, names):
    # Require each reviewed name in a clause that explicitly revokes titles.
    clauses = re.split(r'[。；]', Html(data).root.text())
    for name in names:
        if not any(name in clause and '撤销' in clause and '中国象棋协会' in clause for clause in clauses):
            raise ValueError(f'Title revocation evidence changed for {name}')
    return [dict(provider='cxa-notice', externalId=pub['publishedAt']+':'+name,
                 nativeName=name, name=name, source=pub,
                 titleStatus={'issuer':'CXA','status':'revoked'}) for name in names]


def discover_publications(data):
    known = {CXA_PAGE, *(url for _, url, _ in TITLE_NOTICES)}
    found = {}
    root = Html(data).root
    if '通知公告' not in root.text():
        raise ValueError('Unrecognized official notice index')
    for anchor in root.all('a'):
        title = anchor.attrs.get('title') or anchor.text()
        url = urljoin(CXA_NOTICES, anchor.attrs.get('href',''))
        if ('象棋' in title and '国际象棋' not in title
                and any(word in title for word in ('称号','大师','技术等级','授予','注册','处罚'))
                and re.fullmatch(r'https://www\.sport\.gov\.cn/[^?#]+/content.html', url)
                and url not in known):
            found[url] = {'title':title, 'url':url, 'status':'publication-review-required'}
    return list(found.values())
